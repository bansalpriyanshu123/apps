// Search inside the open document: the search bar, finding the phrase on every page, and jumping between hits.
//
// PDF pages load their text lazily, so opening the bar starts a background pass that extracts the text of every page
// (without Gemini); hits already found can be browsed while the pass is still running. Pressing ▶ after a jump reads
// from the hit.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { on } from '../core/bus.js';
import { ensureText } from '../document/page-text.js';
import { findLines } from '../text/search.js';
import { clearFound, readPositionOf, showFound } from '../viewer/found-mark.js';
import { goToPage } from '../viewer/pager.js';

const TYPING_DELAY_MS = 250;

let hits = [];            // [{ pg, index }] in document order
let current = -1;         // index into hits of the hit on screen
let indexing = null;      // { docId, done } while pages are being read for the search
let typingTimer = null;

export const isSearchOpen = () => !el.searchbar.hidden;

function setCount() {
  const query = el.searchInput.value.trim();
  const pending = indexing && indexing.done < state.pages.length;
  let text = '';
  if (query) {
    if (hits.length) text = (current + 1) + ' / ' + hits.length + (pending ? '+' : '');
    else text = pending ? '…' : 'No match';
  } else if (pending) {
    text = indexing.done + ' / ' + state.pages.length;
  }
  el.searchCount.textContent = text;
  el.searchPrev.disabled = el.searchNext.disabled = !hits.length;
}

/** Recomputes the hits from the text of the pages that are ready, keeping the current hit when it is still there. */
function collect() {
  const keep = hits[current];
  hits = [];
  const query = el.searchInput.value;
  if (query.trim()) {
    for (const pg of state.pages) for (const index of findLines(pg.lines, query)) hits.push({ pg, index });
  }
  current = keep ? hits.findIndex((hit) => hit.pg === keep.pg && hit.index === keep.index) : -1;
  setCount();
}

function jumpTo(i) {
  if (!hits.length) return;
  current = (i + hits.length) % hits.length;
  const { pg, index } = hits[current];
  goToPage(pg.num, false);
  showFound(pg, index);
  if (!state.playing) state.resumePos = readPositionOf(pg, index);      // ▶ now reads from this hit
  setCount();
}

/** Reads the text of every page once (in the background) so the search covers the whole document. */
async function indexPages() {
  if (indexing && indexing.docId === state.docId) return;
  const job = { docId: state.docId, done: 0 };
  indexing = job;
  for (const pg of state.pages) {
    if (indexing !== job) return;                              // another document was opened meanwhile
    try { await ensureText(pg, false); } catch (err) { /* an unreadable page simply has no hits */ }
    job.done++;
    if (job.done % 5 === 0 || job.done === state.pages.length) { collect(); }
  }
  collect();
}

function startFromCurrentPage() {
  collect();
  if (!hits.length) return;
  const first = hits.findIndex((hit) => hit.pg.num >= state.currentPage);
  jumpTo(first < 0 ? 0 : first);
}

export function openSearch() {
  if (!state.doc) return;
  el.searchbar.hidden = false;
  el.searchBtn.classList.add('on');
  el.searchInput.focus();
  el.searchInput.select();
  indexPages().then(() => { if (isSearchOpen() && el.searchInput.value.trim() && current < 0) startFromCurrentPage(); });
  setCount();
}

export function closeSearch() {
  el.searchbar.hidden = true;
  el.searchBtn.classList.remove('on');
  clearFound();
  hits = [];
  current = -1;
}

export function initSearch() {
  el.searchBtn.addEventListener('click', () => (isSearchOpen() ? closeSearch() : openSearch()));
  el.searchClose.addEventListener('click', closeSearch);
  el.searchNext.addEventListener('click', () => jumpTo(current + 1));
  el.searchPrev.addEventListener('click', () => jumpTo(current - 1));
  el.searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { clearFound(); current = -1; startFromCurrentPage(); }, TYPING_DELAY_MS);
  });
  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(typingTimer);
    if (current < 0) startFromCurrentPage(); else jumpTo(current + (event.shiftKey ? -1 : 1));
  });

  on('document:opened', () => { if (isSearchOpen()) closeSearch(); indexing = null; hits = []; current = -1; });
  on('page:lines-changed', () => { if (isSearchOpen()) collect(); });          // Gemini replaced a page's lines
}
