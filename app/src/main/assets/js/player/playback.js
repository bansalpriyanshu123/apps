// Reading the document aloud, sentence by sentence: start, pause, stop, step, continue across pages.
//
// Every user action that (re)starts speech takes a new `token`. Anything that finishes later - Gemini OCR of the next
// page, a sentence that ended - checks its token first, so a stale result can never start speaking after you
// pressed Stop or tapped somewhere else.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { on } from '../core/bus.js';
import { LAST } from '../core/config.js';
import { hasKey, settings } from '../core/store.js';
import { deviceTts, newJob, cancelJob, stopAudio, speakText, prefetchGemini } from '../services/speech.js';
import { ensureText } from '../document/page-text.js';
import { sentenceText } from '../text/sentences.js';
import { clearHighlight, showHighlight } from '../viewer/highlight.js';
import { refreshBanner } from '../ui/banner.js';
import { setNotice } from '../ui/notice.js';
import { selectedVoice } from './voices.js';
import { renderPlayState, showIdle, showPreparing, showSentence } from './now-bar.js';

let token = 0;
let keepAliveOn = false;

function renderState() {
  renderPlayState(state.playing, !!(state.active || state.playing || state.resumePos));
  if (state.playing !== keepAliveOn) {          // tell Android to keep the process alive while speaking
    keepAliveOn = state.playing;
    deviceTts.setPlaying(state.playing, 'PDF Voice Reader');
  }
}

/** Marks sentence `s` of page `p` as the current one (or clears it with p == null). */
function setActive(p, s, from) {
  clearHighlight(state.active);
  if (p == null) {
    state.active = null;
    showIdle();
    return;
  }
  state.active = { p, s, from: from || 0 };
  const pg = state.pages[p - 1];
  showHighlight(p, s, from);
  showSentence(sentenceText(pg.lines, pg.segs[s], from), 'Page ' + p + ' · ' + (s + 1) + ' / ' + pg.segs.length);
}

function blockedMessage(pg) {
  if (!hasKey()) return 'Page ' + pg.num + ' has garbled text (old Hindi font). Add a Gemini key under ⚙ so it can be read properly.';
  if (settings.ocrMode === 'never') return 'Page ' + pg.num + ' has garbled text and Gemini reading is switched off in settings.';
  if (pg.geminiState === 'error') return 'Gemini could not read page ' + pg.num + '. Tap the page text to retry.';
  return 'Page ' + pg.num + ' has garbled text.';
}

const usingPdfText = (pg) => !pg.lines.length || pg.lines[0].source === 'pdf';

/**
 * Finds the page / sentence to speak, loading text (and Gemini OCR) as needed, walking over empty pages and across
 * page boundaries. Resolves to null if the request went stale or the page is unreadable garbage.
 */
async function locate(p, s, myToken) {
  while (p >= 1 && p <= state.pdfDoc.numPages) {
    const pg = state.pages[p - 1];
    if (myToken === token && !pg.textReady) showPreparing(p);
    await ensureText(pg, true);
    if (myToken !== token) return null;
    if (pg.garbled && usingPdfText(pg)) {
      setNotice(blockedMessage(pg), true);
      refreshBanner(true);
      return null;
    }
    const count = pg.segs.length;
    if (s === LAST) s = count - 1;
    if (s >= 0 && s < count) return { p, s };
    if (s < 0) { p--; s = LAST; } else { p++; s = 0; }
  }
  return null;
}

/**
 * Speaks sentence `s` of page `p`.
 * @param auto     true when moving on by itself to the next sentence: don't cut the engine off, let it finish its tail
 * @param fromIdx  start that many lines into the sentence (a tap on a line in the middle of one)
 */
export async function speakSentence(p, s, auto, fromIdx) {
  if (!state.pdfDoc) return;
  const myToken = ++token;
  cancelJob();
  if (!auto) stopAudio();
  state.playing = true;
  renderState();

  const requested = state.pages[Math.min(Math.max(p, 1), state.pdfDoc.numPages) - 1];
  if (requested.geminiState === 'error') requested.geminiState = 'idle';     // a tap is an explicit retry

  let position;
  try {
    position = await locate(p, s, myToken);
  } catch (err) {
    position = null;
    if (myToken === token) setNotice('Could not prepare the page: ' + err.message, true);
  }
  if (myToken !== token) return;
  if (!position) { endPlayback(); return; }

  const pg = state.pages[position.p - 1];
  const from = (fromIdx && position.p === p && position.s === s)
    ? Math.min(fromIdx, pg.segs[position.s].lines.length - 1)
    : 0;
  setActive(position.p, position.s, from);
  renderState();

  const voice = selectedVoice();
  const job = newJob(
    () => {
      if (myToken !== token) return;
      if (state.cont) speakSentence(position.p, position.s + 1, true); else endPlayback();
    },
    (message) => {
      if (myToken !== token) return;
      endPlayback();
      setNotice('Speech failed: ' + message, true);
    }
  );
  speakText(sentenceText(pg.lines, pg.segs[position.s], from), voice, state.rate, job, auto);
  if (voice && voice.gemini && state.cont) {
    for (let k = 1; k <= 2; k++) {
      const next = pg.segs[position.s + k];
      if (next) prefetchGemini(next.text, voice);
    }
  }
}

function endPlayback() {
  state.playing = false;
  state.resumePos = null;
  setActive(null);
  renderState();
}

export function pause() {
  if (!state.playing) return;
  token++;
  cancelJob();
  stopAudio();
  state.resumePos = state.active;
  state.playing = false;
  renderState();
}

export function stop() {
  token++;
  cancelJob();
  stopAudio();
  state.playing = false;
  state.resumePos = null;
  setActive(null);
  renderState();
}

export function togglePlay() {
  if (!state.pdfDoc) { el.fileInput.click(); return; }
  if (state.playing) pause();
  else if (state.resumePos) speakSentence(state.resumePos.p, state.resumePos.s, false, state.resumePos.from);
  else speakSentence(state.currentPage, 0);
}

/** Previous / next sentence (dir = -1 / +1). With nothing playing yet, starts from the top of the current page. */
export function step(dir) {
  if (!state.pdfDoc) return;
  const base = state.active || state.resumePos;
  if (!base) { speakSentence(state.currentPage, 0); return; }
  speakSentence(base.p, base.s + dir);
}

/** Speaks the current sentence again from the same line (after a voice or speed change). */
export function restartCurrent() {
  if (state.playing && state.active) speakSentence(state.active.p, state.active.s, false, state.active.from);
}

export function initPlayback() {
  renderState();
  on('line:tap', ({ page, seg, offset }) => speakSentence(page, seg, false, offset));
  on('player:pause', pause);
  on('voice:changed', restartCurrent);
}
