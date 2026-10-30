// Getting a page's text: pdf.js's own text layer first, Gemini's reading of the page picture when that text is
// garbled / lossy / missing. This is the only place that decides which lines a page uses.

import { OCR_KEY_PREFIX } from '../core/config.js';
import { state } from '../core/state.js';
import { hasKey, settings } from '../core/store.js';
import { emit, on } from '../core/bus.js';
import { ocrCache } from '../core/ocr-cache.js';
import { transformMatrix } from '../services/pdf-engine.js';
import { readPageWithGemini } from '../services/gemini-ocr.js';
import { classifyLostGlyphs } from '../services/glyph-kinds.js';
import { readPageGlyphs } from '../services/page-glyphs.js';
import { correctItems, usesSpaceGlyphs } from '../text/glyph-table.js';
import { groupLines } from '../text/line-grouping.js';
import { hasLostGlyphs, looksGarbled } from '../text/devanagari.js';
import { buildSentences } from '../text/sentences.js';
import { loadPage } from './page-model.js';
import { refreshBanner } from '../ui/banner.js';
import { setNotice } from '../ui/notice.js';

const cacheKey = (pg) => OCR_KEY_PREFIX + state.docId + ':' + pg.num;

/** Should this page's text come from Gemini under the current settings? */
export function needsGemini(pg) {
  if (pg.kind === 'docx') return false;
  if (settings.ocrMode === 'never') return false;
  if (settings.ocrMode === 'always') return true;
  return pg.garbled || pg.damaged || (pg.pdfLines || []).length === 0;
}

/** Chooses which line set is live for the page (Gemini's if we have it) and rebuilds its sentences. */
export function applyLines(pg) {
  if (pg.ocr && pg.geminiState === 'done' && settings.ocrMode !== 'never') {
    const vp = pg.vp;
    pg.lines = pg.ocr.map((o) => ({
      text: o.text,
      left: o.b[1] * vp.width,
      top: o.b[0] * vp.height,
      width: Math.max((o.b[3] - o.b[1]) * vp.width, 8),
      height: Math.max((o.b[2] - o.b[0]) * vp.height, 8),
      source: 'gemini'
    }));
  } else {
    pg.lines = pg.pdfLines || [];
  }
  pg.segs = buildSentences(pg.lines);
  pg.linesLaidOut = false;
}

/** Recomputes line boxes after the scale changed (the text itself is already extracted). */
export function rebuildLines(pg) {
  if (!pg.rawItems) return false;
  extractPdfLines(pg);
  applyLines(pg);
  return true;
}

const countNul = (text) => text.split(String.fromCharCode(0)).length - 1;

/**
 * Keeps the page's non-empty text items, each tagged with what its lost glyphs (NULs) really are, when the page's
 * drawing instructions can tell (see services/glyph-kinds.js). If the glyphs and the NULs do not line up, no tags
 * are added and the text repair guesses from position instead.
 */
async function withLostGlyphKinds(pg, items, glyphs) {
  let kinds = null;
  if (pg.damaged) {
    try { kinds = await classifyLostGlyphs(pg.page, glyphs || await readPageGlyphs(pg.page)); } catch (err) { kinds = null; }
    const nulls = items.reduce((total, item) => total + countNul(item.str), 0);
    if (!kinds || kinds.length !== nulls) kinds = null;
  }
  let next = 0;
  let spaceBefore = false;
  const kept = [];
  for (const item of items) {
    const count = kinds ? countNul(item.str) : 0;
    const itemKinds = kinds && count ? kinds.slice(next, next + count) : undefined;
    next += count;
    if (item.str && item.str.trim()) {
      // a blank item is a real space glyph: where all spaces are real ones, the next chunk starts with it
      const str = spaceBefore && item.exactSpaces && !/^\s/.test(item.str) ? ' ' + item.str : item.str;
      kept.push({ str, transform: item.transform, width: item.width, kinds: itemKinds, exactSpaces: item.exactSpaces });
      spaceBefore = false;
    } else if (item.str) {
      spaceBefore = true;
    }
  }
  return kept;
}

const DEVANAGARI_OR_LOST = new RegExp('[' + String.fromCharCode(0x900) + '-' + String.fromCharCode(0x97F) + String.fromCharCode(0) + String.fromCharCode(0xFFFD) + ']');

/**
 * Puts right the text of glyphs whose font is in the table of known fonts (text/glyph-table.js), for PDFs whose own
 * glyph -> text map is wrong. Pages without Devanagari are not touched. If the glyphs cannot be matched up with the
 * text items the page is left exactly as pdf.js produced it.
 * @returns { items, glyphs } - the (possibly corrected) items and the page's glyphs (null when they were not read)
 */
async function withGlyphTable(pg, items) {
  if (!items.some((item) => DEVANAGARI_OR_LOST.test(item.str))) return { items, glyphs: null };
  let glyphs;
  try { glyphs = await readPageGlyphs(pg.page); } catch (err) { return { items, glyphs: null }; }
  if (!glyphs.some((glyph) => glyph.text !== null)) return { items, glyphs };
  const corrected = correctItems(items, glyphs, { dropInsertedSpaces: usesSpaceGlyphs(glyphs) });
  if (corrected) return { items: corrected, glyphs };
  for (const glyph of glyphs) glyph.text = null;
  return { items, glyphs };
}

function extractPdfLines(pg) {
  pg.pdfLines = groupLines({
    items: pg.rawItems,
    viewport: pg.vp,
    transform: transformMatrix,
    visualOrder: state.docVisualOrder || pg.damaged
  });
}

/**
 * Resolves when the page's lines are ready. With `useGemini`, also starts Gemini on the page if it needs it and
 * waits for the result.
 */
export function ensureText(pg, useGemini) {
  if (!pg.textReady) {
    pg.textReady = loadPage(pg).then(() => pg.page.getTextContent()).then(async (content) => {
      const { items, glyphs } = await withGlyphTable(pg, content.items);
      pg.damaged = hasLostGlyphs(items);
      if (pg.damaged) state.docVisualOrder = true;
      pg.rawItems = await withLostGlyphKinds(pg, items, glyphs);
      extractPdfLines(pg);
      pg.garbled = looksGarbled(pg.pdfLines);
      const cached = await ocrCache.get(cacheKey(pg));
      if (cached) { pg.ocr = cached; pg.geminiState = 'done'; }
      applyLines(pg);
      refreshBanner();
    });
  }
  return pg.textReady.then(() => {
    if (!useGemini || !hasKey() || !needsGemini(pg)) return undefined;
    if (pg.geminiState === 'idle') return scheduleGemini(pg);
    if (pg.geminiState === 'pending') return pg.geminiPromise;
    return undefined;
  });
}

// Gemini reads one page at a time (free-tier keys are rate limited).
let geminiQueue = Promise.resolve();

function scheduleGemini(pg) {
  if (!hasKey() || !needsGemini(pg) || pg.geminiState === 'done' || pg.geminiState === 'pending') {
    return pg.geminiPromise || Promise.resolve();
  }
  pg.geminiState = 'pending';
  emit('page:status', { pg, text: 'Gemini is reading this page…', spinning: true });
  pg.geminiPromise = (geminiQueue = geminiQueue.then(async () => {
    if (pg.geminiState !== 'pending') return;
    try {
      pg.ocr = await readPageWithGemini(pg.page);
      pg.geminiState = 'done';
      ocrCache.set(cacheKey(pg), pg.ocr);
      applyLines(pg);
      emit('page:lines-changed', pg);
      emit('page:status', { pg, text: '' });
    } catch (err) {
      pg.geminiState = 'error';
      emit('page:status', { pg, text: 'Gemini: ' + err.message, isError: true });
      setNotice('Gemini could not read page ' + pg.num + ': ' + err.message, true);
    }
    refreshBanner();
  }));
  return pg.geminiPromise;
}

/** Re-evaluates which pages should come from Gemini whenever the settings change. */
export function initPageText() {
  on('settings:saved', () => {
    if (!state.doc) return;
    for (const pg of state.pages) {
      if (pg.kind === 'docx') continue;                    // Word text never changes with these settings
      if (pg.geminiState === 'error') pg.geminiState = 'idle';
      if (!pg.textReady) continue;
      pg.textReady.then(() => {
        applyLines(pg);
        emit('page:lines-changed', pg);
        if (pg.visible) ensureText(pg, true);
      });
    }
    refreshBanner();
  });
}
