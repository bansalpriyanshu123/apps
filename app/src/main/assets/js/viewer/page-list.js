// Building the scrolling list of pages for a freshly opened PDF, and deciding when each page is drawn.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { on } from '../core/bus.js';
import { createPage, sizePage } from '../document/page-model.js';
import { ensureText } from '../document/page-text.js';
import { computeScale } from './layout.js';
import { setPageBadge } from './page-badge.js';
import { renderPage, unrenderPage } from './renderer.js';

const DRAW_MARGIN = '900px 0px';   // start drawing a page this far before it reaches the screen
const DWELL_MS = 700;              // Gemini reads a page only after you stay on it this long

let drawObserver = null;
let dwellObserver = null;

const pageOf = (entry) => state.pages[parseInt(entry.target.dataset.page, 10) - 1];

/** Forgets the PDF pages (stops watching them) so another kind of document can take over the page list. */
export function clearPdfPages() {
  if (drawObserver) drawObserver.disconnect();
  if (dwellObserver) dwellObserver.disconnect();
  el.pages.innerHTML = '';
  state.pages = [];
}

function createPageBox(pg) {
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.dataset.page = pg.num;

  const canvas = document.createElement('canvas');
  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  const number = document.createElement('span');
  number.className = 'num';
  number.textContent = pg.num;
  const badge = document.createElement('span');
  badge.className = 'badge';

  wrap.append(canvas, textLayer, number, badge);
  Object.assign(pg, { wrap, canvas, textLayer, badge });
  return wrap;
}

/** Replaces the page list with one for state.doc. Only page 1 is read up front; the rest are placeholders. */
export async function buildPages() {
  clearPdfPages();

  const first = await state.doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  state.scale = computeScale(base.width);
  for (let n = 1; n <= state.doc.numPages; n++) state.pages.push(createPage(n, first, base));

  drawObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const pg = pageOf(entry);
      if (!pg) continue;
      if (entry.isIntersecting) renderPage(pg).catch(() => {}); else unrenderPage(pg);
    }
  }, { rootMargin: DRAW_MARGIN });

  // Gemini only reads a page once you actually dwell on it, not while you scroll past.
  dwellObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const pg = pageOf(entry);
      if (!pg) continue;
      pg.visible = entry.isIntersecting;
      clearTimeout(pg.dwell);
      if (entry.isIntersecting) {
        pg.dwell = setTimeout(() => { if (pg.visible) ensureText(pg, true).catch(() => {}); }, DWELL_MS);
      }
    }
  }, { threshold: 0.15 });

  for (const pg of state.pages) {
    const wrap = createPageBox(pg);
    sizePage(pg);
    el.pages.appendChild(wrap);
    drawObserver.observe(wrap);
    dwellObserver.observe(wrap);
  }
}

export function initPageList() {
  on('page:status', ({ pg, text, spinning, isError }) => setPageBadge(pg, text, spinning, isError));
}
