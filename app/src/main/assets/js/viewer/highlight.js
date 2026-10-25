// Highlighting the sentence that is being read. Pure DOM; the playback state lives in player/playback.js.
// PDF pages highlight their tappable line boxes; Word sections highlight a text Range (see docx-view.js).

import { state } from '../core/state.js';
import { clearDocxHighlight, showDocxHighlight } from './docx-view.js';

/** The tappable line boxes of sentence `s` on PDF page `p`, starting `from` lines into it. */
export function lineElements(p, s, from) {
  const pg = state.pages[p - 1];
  const sentence = pg && pg.segs[s];
  if (!sentence || pg.kind === 'docx') return [];
  return sentence.lines.slice(from || 0).map((index) => pg.textLayer.children[index]).filter(Boolean);
}

/** Removes the highlight of a sentence ({ p, s } as stored in state.active). */
export function clearHighlight(active) {
  if (!active) return;
  const pg = state.pages[active.p - 1];
  if (pg && pg.kind === 'docx') { clearDocxHighlight(); return; }
  lineElements(active.p, active.s).forEach((box) => box.classList.remove('active'));
}

/** Highlights a sentence and scrolls its first line to the middle of the screen. */
export function showHighlight(p, s, from) {
  const pg = state.pages[p - 1];
  if (pg && pg.kind === 'docx') { showDocxHighlight(pg, s); return; }
  const boxes = lineElements(p, s, from);
  boxes.forEach((box) => box.classList.add('active'));
  if (boxes[0]) boxes[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}
