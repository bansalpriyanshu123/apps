// Drawing pages onto their canvases, and un-drawing them again to save memory.
//
// One render loop per page. `gen` changes whenever a page is invalidated (zoom, dark switch, scrolled away); a render
// that finishes for an older `gen` is thrown away and redone if the page is still wanted. Nothing can start a second
// render on the same canvas while one is running (pdf.js refuses that and the page would stay blank).

import { state } from '../core/state.js';
import { on } from '../core/bus.js';
import { loadPage } from '../document/page-model.js';
import { ensureText } from '../document/page-text.js';
import { layoutLines } from './line-layer.js';

const MAX_BITMAP_PIXELS = 3_200_000;   // zoomed-in pages are big and the target phones have little RAM
const NEAR_MARGIN = 900;               // draw pages within this many px of the screen
const REPAIR_MARGIN = 300;

export function renderPage(pg) {
  if (pg.kind === 'docx') return Promise.resolve();      // Word sections are ordinary HTML, nothing to draw
  pg.wantRender = true;
  if (pg.rendered) { pg.wantRender = false; return Promise.resolve(); }
  if (pg.rendering) return pg.rendering;

  pg.rendering = (async () => {
    try {
      while (pg.wantRender && !pg.rendered) {
        pg.wantRender = false;
        const gen = pg.gen;
        await loadPage(pg);
        if (gen !== pg.gen) continue;

        const viewport = pg.vp;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (viewport.width * viewport.height * dpr * dpr > MAX_BITMAP_PIXELS) {
          dpr = Math.sqrt(MAX_BITMAP_PIXELS / (viewport.width * viewport.height));
        }
        pg.canvas.width = Math.floor(viewport.width * dpr);
        pg.canvas.height = Math.floor(viewport.height * dpr);
        const ctx = pg.canvas.getContext('2d');
        const task = pg.page.render({ canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
        pg.renderTask = task;
        try {
          await task.promise;
        } catch (err) {
          if (err && err.name === 'RenderingCancelledException') continue;
          throw err;
        } finally {
          if (pg.renderTask === task) pg.renderTask = null;
        }
        if (gen !== pg.gen) continue;

        if (state.darkPages) invertCanvas(ctx, pg.canvas);
        pg.rendered = true;
      }
      if (pg.rendered) { await ensureText(pg); layoutLines(pg); }
    } finally {
      pg.rendering = null;
    }
  })();
  return pg.rendering;
}

/** White paper -> black, black text -> light grey (difference with white inverts; multiply then softens it). */
function invertCanvas(ctx, canvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#dde2e8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export function unrenderPage(pg) {
  if (pg.kind === 'docx') return;
  pg.gen++;
  pg.wantRender = false;
  if (pg.renderTask) { try { pg.renderTask.cancel(); } catch (err) { /* already finished */ } }
  pg.rendered = false;
  if (pg.canvas.width) { pg.canvas.width = 0; pg.canvas.height = 0; }
}

/** Throws every drawing away and redraws the pages near the screen (dark switch, resize, zoom). */
export function rerenderNearby() {
  for (const pg of state.pages) unrenderPage(pg);
  for (const pg of state.pages) {
    const rect = pg.wrap.getBoundingClientRect();
    if (rect.bottom > -NEAR_MARGIN && rect.top < window.innerHeight + NEAR_MARGIN) renderPage(pg).catch(() => {});
  }
}

/** Safety net: a page that is on (or just next to) the screen but neither drawn nor being drawn gets drawn. */
export function ensureVisibleRendered() {
  if (!state.doc || !state.pages.length) return;
  for (const pg of state.pages) {
    if (pg.rendered || pg.rendering) continue;
    const rect = pg.wrap.getBoundingClientRect();
    if (rect.bottom > -REPAIR_MARGIN && rect.top < window.innerHeight + REPAIR_MARGIN) renderPage(pg).catch(() => {});
  }
}

export function initRenderer() {
  let settleTimer = null;
  window.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(ensureVisibleRendered, 200);
  }, { passive: true });

  on('theme:dark', () => { if (state.doc && state.pages.length) rerenderNearby(); });
  // new lines for a page that is already on screen: lay out its tappable boxes again
  on('page:lines-changed', (pg) => { if (pg.rendered) layoutLines(pg); });
}
