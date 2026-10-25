// Works out what each "lost" glyph on a page really is, by reading the page's drawing instructions.
//
// pdf.js reports a NUL in the page text for every glyph that its font cannot map to Unicode. The same glyphs are in
// the drawing instructions, in the same order, together with facts the text does not have:
//   advance width 0                    -> a lone र् mark
//   same advance as a real ि            -> a ि
//   same advance as a real ा            -> a ligature of र् with a vowel sign. Which one? The ी has a hook that
//                                          reaches left of the glyph origin; the ो does not. We draw the glyph with
//                                          the PDF's own embedded font and count the ink left of the origin.
// The result is one kind per NUL, in order (text/lost-glyphs.js turns them into letters). Where a glyph cannot be
// classified the entry is null and the caller falls back to guessing from position.

import { KIND } from '../text/lost-glyphs.js';
import { pdfOps } from './pdf-engine.js';

const NUL = String.fromCharCode(0);
const AA = 'ा';
const I = 'ि';

const INK = { size: 100, originX: 200, baseline: 250, canvas: 400, hookLeftInk: 250 };
let probeContext = null;
const inkCache = new Map();
let knownWidths = {};     // advances of ि / ा seen on earlier pages (subset fonts of one font share metrics)

const countNul = (text) => text.split(NUL).length - 1;

/** Ink pixels to the left of a glyph's origin, drawn with the PDF's embedded font at 100px. */
async function inkLeftOfOrigin(family, fontChar) {
  const key = family + '|' + fontChar;
  if (inkCache.has(key)) return inkCache.get(key);
  if (!probeContext) {
    const canvas = document.createElement('canvas');
    canvas.width = INK.canvas;
    canvas.height = INK.canvas;
    probeContext = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = probeContext;
  await document.fonts.load(INK.size + 'px "' + family + '"');
  ctx.clearRect(0, 0, INK.canvas, INK.canvas);
  ctx.fillStyle = '#000';
  ctx.font = INK.size + 'px "' + family + '"';
  ctx.fillText(fontChar, INK.originX, INK.baseline);
  const pixels = ctx.getImageData(0, 0, INK.canvas, INK.canvas).data;
  let left = 0;
  for (let y = 0; y < INK.canvas; y++) {
    for (let x = 0; x < INK.originX - 3; x++) if (pixels[(y * INK.canvas + x) * 4 + 3] > 100) left++;
  }
  inkCache.set(key, left);
  return left;
}

async function classify(glyph, fontId, widths, page) {
  const advance = glyph.width;
  if (Math.abs(advance) < 1) return KIND.REPH;
  if (widths.i != null && Math.abs(advance - widths.i) <= 2) return KIND.I;
  if (widths.aa != null && Math.abs(advance - widths.aa) <= 2) {
    let family = null;
    try { family = page.commonObjs.get(fontId).loadedName; } catch (err) { return null; }   // font not available
    if (!family || !glyph.fontChar) return null;
    return (await inkLeftOfOrigin(family, glyph.fontChar)) >= INK.hookLeftInk ? KIND.REPH_II : KIND.REPH_O;
  }
  return null;
}

/**
 * @param page  a pdf.js page
 * @returns one kind (or null) per NUL that page.getTextContent() reports, in the same order
 */
export async function classifyLostGlyphs(page) {
  const OPS = pdfOps();
  const ops = await page.getOperatorList();
  const lost = [];
  const widthsByFont = new Map();
  let fontId = null;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.setFont) { fontId = ops.argsArray[i][0]; continue; }
    if (fn !== OPS.showText && fn !== OPS.showSpacedText) continue;
    if (!widthsByFont.has(fontId)) widthsByFont.set(fontId, {});
    const widths = widthsByFont.get(fontId);
    for (const glyph of ops.argsArray[i][0] || []) {
      if (!glyph || typeof glyph !== 'object') continue;       // numbers are kerning adjustments
      const unicode = glyph.unicode || '';
      if (unicode === I) widths.i = glyph.width;
      else if (unicode === AA) widths.aa = glyph.width;
      for (let n = countNul(unicode); n > 0; n--) lost.push({ glyph, fontId });
    }
  }
  for (const widths of widthsByFont.values()) knownWidths = { ...knownWidths, ...widths };

  const kinds = [];
  for (const { glyph, fontId: id } of lost) {
    kinds.push(await classify(glyph, id, { ...knownWidths, ...widthsByFont.get(id) }, page));
  }
  return kinds;
}
