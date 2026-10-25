// The top bar is fixed (so it stays put while a zoomed page scrolls sideways); <main> is pushed down by its height,
// which therefore has to be mirrored into the --bar-h CSS variable whenever it changes.

import { el } from '../core/dom.js';

export function syncBarHeight() {
  document.documentElement.style.setProperty('--bar-h', el.bar.offsetHeight + 'px');
}

export function initHeader() {
  syncBarHeight();
  if (window.ResizeObserver) new ResizeObserver(syncBarHeight).observe(el.bar);
  window.addEventListener('resize', syncBarHeight);
}
