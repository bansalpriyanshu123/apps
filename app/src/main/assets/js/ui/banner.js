// The yellow banner that tells the user a PDF's own text is unreliable and offers the Gemini setup.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { hasKey, settings } from '../core/store.js';

const MESSAGES = {
  garbled: 'The text inside this PDF is garbled or missing (it was probably made with an old Hindi font, or it is a scan). ' +
    'Gemini can read the pages properly — add a free API key to turn it on.',
  damaged: 'This PDF’s built-in text is missing some letters and matras. The app repairs the common ones automatically, ' +
    'but some words may still be read wrongly. Gemini can read the pages from the picture for exact text — add a free API key to turn it on.',
  switchedOff: 'This PDF’s text looks garbled or incomplete. Gemini reading is switched off in settings.'
};

function show(text) {
  el.bannerText.textContent = text;
  el.banner.classList.add('show');
}

/** @param force  show the "garbled" message even if no page has been inspected yet (a tap on a garbled page) */
export function refreshBanner(force) {
  if (!state.pdfDoc) return;
  const notDone = (pg) => pg.geminiState !== 'done';
  const anyGarbled = force || state.pages.some((pg) =>
    pg.pdfLines && (pg.garbled || (pg.rendered && pg.pdfLines.length === 0)) && notDone(pg));
  const anyDamaged = state.pages.some((pg) => pg.pdfLines && pg.damaged && notDone(pg));
  const problem = anyGarbled || anyDamaged;

  if (problem && !hasKey() && settings.ocrMode !== 'never') show(anyGarbled ? MESSAGES.garbled : MESSAGES.damaged);
  else if (problem && hasKey() && settings.ocrMode === 'never') show(MESSAGES.switchedOff);
  else el.banner.classList.remove('show');
}
