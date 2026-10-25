// Zooming the document: + / - buttons, pinch, Ctrl+wheel and the keyboard. Zoom 1 = fit to the screen width.
//
// While you pinch, the pages are scaled live with a CSS transform (cheap). On release the pages are re-laid out and
// redrawn sharply at the new zoom, keeping the point under your fingers where it was.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { PREF, ZOOM } from '../core/config.js';
import { loadPref, savePref } from '../core/store.js';
import { clamp } from '../core/util.js';
import { computeScale, relayout } from './layout.js';
import { ensureVisibleRendered, rerenderNearby } from './renderer.js';
import { trackScroll } from './pager.js';

const IDLE_MS = 2500;
let idleTimer = null;

function updateZoomUi() {
  el.zoomVal.textContent = Math.round(state.zoom * 100) + '%';
  el.zoomOut.disabled = state.zoom <= ZOOM.min + 0.001;
  el.zoomIn.disabled = state.zoom >= ZOOM.max - 0.001;
  el.stage.classList.toggle('zoomed', state.zoom > 1);
  el.zoombar.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => el.zoombar.classList.add('idle'), IDLE_MS);
}

/** Shows the zoom control for a freshly opened document. */
export function showZoomControl() {
  el.zoombar.classList.add('show');
  el.stage.classList.toggle('zoomed', state.zoom > 1);
}

/** Zooms, keeping the point under (anchorX, anchorY) where it is on screen. */
export function setZoom(requested, anchorX, anchorY) {
  const zoom = clamp(Math.round(requested * 100) / 100, ZOOM.min, ZOOM.max);
  if (anchorX == null) anchorX = window.innerWidth / 2;
  if (anchorY == null) anchorY = window.innerHeight * 0.4;
  if (!state.pdfDoc || !state.pages.length) { state.zoom = zoom; updateZoomUi(); return; }
  if (zoom === state.zoom) { updateZoomUi(); return; }

  // remember which spot of which page is under the anchor
  let anchor = null;
  for (const pg of state.pages) {
    const rect = pg.wrap.getBoundingClientRect();
    if (rect.bottom >= anchorY) {
      anchor = {
        pg,
        fx: rect.width ? (anchorX - rect.left) / rect.width : 0,
        fy: rect.height ? (anchorY - rect.top) / rect.height : 0
      };
      break;
    }
  }

  state.zoom = zoom;
  savePref(PREF.zoom, String(zoom));
  el.stage.classList.toggle('zoomed', zoom > 1);
  state.scale = computeScale(state.pages[0].base.width);

  // Order matters: resize -> fix the scroll position -> only then redraw what is on screen. (Redrawing first drew the
  // pages that were near the old scroll position, and the pages that ended up on screen stayed blank.)
  relayout(true);
  if (anchor) {
    const rect = anchor.pg.wrap.getBoundingClientRect();
    window.scrollBy(rect.left + anchor.fx * rect.width - anchorX, rect.top + anchor.fy * rect.height - anchorY);
  }
  rerenderNearby();
  updateZoomUi();
  trackScroll();
  requestAnimationFrame(ensureVisibleRendered);     // safety net for layout that settles late
  setTimeout(ensureVisibleRendered, 500);
}

export const zoomBy = (delta) => setZoom(state.zoom + delta);

function initPinch() {
  let pinch = null;
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2 || !state.pdfDoc) return;
    const [a, b] = event.touches;
    pinch = { d0: distance(a, b) || 1, z0: state.zoom, k: 1, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    const rect = el.pages.getBoundingClientRect();
    el.pages.style.transformOrigin = (pinch.x - rect.left) + 'px ' + (pinch.y - rect.top) + 'px';
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = event.touches;
    pinch.k = clamp(distance(a, b) / pinch.d0, ZOOM.min / pinch.z0, ZOOM.max / pinch.z0);
    pinch.x = (a.clientX + b.clientX) / 2;
    pinch.y = (a.clientY + b.clientY) / 2;
    el.pages.style.transform = 'scale(' + pinch.k + ')';
  }, { passive: false });

  const endPinch = (event) => {
    if (!pinch || event.touches.length >= 2) return;
    const finished = pinch;
    pinch = null;
    el.pages.style.transform = '';
    el.pages.style.transformOrigin = '';
    if (Math.abs(finished.k - 1) > 0.02) setZoom(finished.z0 * finished.k, finished.x, finished.y);
  };
  document.addEventListener('touchend', endPinch);
  document.addEventListener('touchcancel', endPinch);
}

export function initZoom() {
  state.zoom = clamp(parseFloat(loadPref(PREF.zoom, '1')) || 1, ZOOM.min, ZOOM.max);
  el.zoomIn.addEventListener('click', () => zoomBy(ZOOM.step));
  el.zoomOut.addEventListener('click', () => zoomBy(-ZOOM.step));
  el.zoomVal.addEventListener('click', () => setZoom(1));
  window.addEventListener('scroll', () => { if (state.pdfDoc) updateZoomUi(); }, { passive: true });
  initPinch();

  // Ctrl + wheel (desktop browsers)
  document.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || !state.pdfDoc) return;
    event.preventDefault();
    setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX, event.clientY);
  }, { passive: false });

  updateZoomUi();
}
