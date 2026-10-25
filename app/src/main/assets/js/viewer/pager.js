// Page navigation: the "‹ 3 / 42 ›" control, scroll tracking, and remembering where you stopped in each PDF.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { PREF } from '../core/config.js';
import { savePref } from '../core/store.js';

const SAVE_DELAY_MS = 800;

export function updatePagerButtons() {
  el.prevPage.disabled = state.currentPage <= 1;
  el.nextPage.disabled = !state.pdfDoc || state.currentPage >= state.pdfDoc.numPages;
}

/** Shows the control for a freshly opened document. */
export function showPager(totalPages) {
  el.pagerCtl.hidden = false;
  el.pageTotal.textContent = totalPages;
  el.pageInput.max = totalPages;
  state.currentPage = 1;
  el.pageInput.value = 1;
  updatePagerButtons();
}

export function goToPage(n, smooth) {
  if (!state.pdfDoc) return;
  n = Math.min(Math.max(1, n), state.pdfDoc.numPages);
  state.pages[n - 1].wrap.scrollIntoView({ block: 'start', behavior: smooth === false ? 'auto' : 'smooth' });
  state.currentPage = n;
  el.pageInput.value = n;
  updatePagerButtons();
}

let saveTimer = null;

/** Works out which page is nearest the middle of the screen; updates the control and saves the position. */
export function trackScroll() {
  if (!state.pdfDoc || !state.pages.length) return;
  const middle = window.innerHeight * 0.4;
  let best = state.currentPage;
  let bestDistance = Infinity;
  for (const pg of state.pages) {
    const rect = pg.wrap.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const distance = Math.abs((rect.top + rect.bottom) / 2 - middle);
    if (distance < bestDistance) { bestDistance = distance; best = pg.num; }
  }
  if (best === state.currentPage) return;

  state.currentPage = best;
  if (document.activeElement !== el.pageInput) el.pageInput.value = best;
  updatePagerButtons();
  clearTimeout(saveTimer);
  const pdfAtScroll = state.pdfId;
  saveTimer = setTimeout(() => {
    if (pdfAtScroll === state.pdfId) savePref(PREF.position(pdfAtScroll), String(best));
  }, SAVE_DELAY_MS);
}

export function initPager() {
  el.prevPage.addEventListener('click', () => goToPage(state.currentPage - 1));
  el.nextPage.addEventListener('click', () => goToPage(state.currentPage + 1));
  el.pageInput.addEventListener('change', () => goToPage(parseInt(el.pageInput.value, 10) || 1));
  el.pageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.pageInput.blur(); }
  });

  let framePending = false;
  window.addEventListener('scroll', () => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => { trackScroll(); framePending = false; });
  }, { passive: true });
}
