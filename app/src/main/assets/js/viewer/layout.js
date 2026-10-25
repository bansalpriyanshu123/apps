// Page geometry: the scale that fits a page to the screen (times the zoom) and re-laying out after it changes.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { sizePage } from '../document/page-model.js';
import { rebuildLines } from '../document/page-text.js';
import { rerenderNearby } from './renderer.js';

const MAX_FIT_WIDTH = 900;     // on wide screens pages stop growing here
const MIN_FIT_WIDTH = 280;
const MAX_FIT_SCALE = 2.5;

/**
 * CSS pixels per PDF point. The width comes from <main>, not from the stage, because the stage itself grows
 * when the document is zoomed in.
 */
export function computeScale(baseWidth) {
  const style = getComputedStyle(el.main);
  const available = el.main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const fitWidth = Math.max(MIN_FIT_WIDTH, Math.min(available, MAX_FIT_WIDTH));
  return Math.min(fitWidth / baseWidth, MAX_FIT_SCALE) * state.zoom;
}

/** New scale: resize every page, rebuild line boxes, and (unless asked not to) redraw the pages near the screen. */
export function relayout(skipRender) {
  for (const pg of state.pages) {
    sizePage(pg);
    if (rebuildLines(pg)) pg.textLayer.innerHTML = '';
  }
  if (!skipRender) rerenderNearby();
}
