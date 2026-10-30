// Marking the search result that is on screen (a different colour from the sentence being read), and scrolling to it.

import { layoutLines } from './line-layer.js';

const FOUND = 'found';       // CSS Custom Highlight name for Word documents (styled in css/docx.css)
let marked = null;           // { pg, index }

export function clearFound() {
  if (!marked) return;
  const { pg, index } = marked;
  marked = null;
  pg.foundLine = null;
  if (pg.kind === 'docx') { if (window.CSS && CSS.highlights) CSS.highlights.delete(FOUND); return; }
  const box = pg.textLayer && pg.textLayer.children[index];
  if (box) box.classList.remove(FOUND);
}

/** Marks line `index` of page `pg` and scrolls it to the middle of the screen. */
export function showFound(pg, index) {
  clearFound();
  const line = pg.lines[index];
  if (!line) return;
  marked = { pg, index };
  pg.foundLine = index;
  if (pg.kind === 'docx') {
    if (window.CSS && CSS.highlights) CSS.highlights.set(FOUND, new Highlight(line.range));
    const rect = line.range.getBoundingClientRect();
    window.scrollBy({ top: rect.top - window.innerHeight * 0.4, behavior: 'auto' });
    return;
  }
  layoutLines(pg);
  const box = pg.textLayer.children[index];
  if (!box) return;
  box.classList.add(FOUND);
  box.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
}

/** Where a search hit on this line should start reading: the sentence it is in and how many lines into it. */
export function readPositionOf(pg, index) {
  const line = pg.lines[index];
  const sentence = line && pg.segs[line.seg];
  return sentence ? { p: pg.num, s: line.seg, from: Math.max(0, sentence.lines.indexOf(index)) } : null;
}
