// Showing a Word file: its HTML (from services/docx-engine.js) is cut into sections that act as "pages" for the pager
// and the player, and every sentence gets a DOM Range so it can be highlighted and tapped. No canvases: Word text is
// real text, so the browser draws it, zooming just changes the font size, and dark mode is plain CSS.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { createDocxPage } from '../document/page-model.js';
import { clearPdfPages } from './page-list.js';
import { looksGarbled } from '../text/devanagari.js';
import { splitSentences } from '../text/sentence-split.js';

const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,figcaption';
const SECTION_BLOCKS = 30;       // a "page" is about this many top-level blocks ...
const SECTION_CHARS = 5000;      // ... or this much text, whichever comes first
const HIGHLIGHT = 'reading';     // name used with the CSS Custom Highlight API (styled in css/docx.css)

/** The text nodes of a block with their offsets inside block.textContent. */
function textNodeMap(block) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const map = [];
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    map.push({ node, start: offset, end: offset + node.data.length });
    offset += node.data.length;
  }
  return map;
}

function rangeFor(map, start, end) {
  const first = map.find((entry) => start < entry.end);
  const last = map.find((entry) => end > entry.start && end <= entry.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

/**
 * The number of a point in an automatically numbered Word list (<ol><li>) is not part of the text, so it would not be read
 * out. It is added to the first sentence of the point ("2. ..."); typed numbers are already in the text.
 */
function listPrefix(block) {
  const item = block.closest('li');
  const list = item && item.parentElement;
  if (!list || list.tagName !== 'OL') return '';
  const leaves = [...item.querySelectorAll(BLOCK_SELECTOR)].filter((node) => !node.querySelector(BLOCK_SELECTOR));
  if (block !== item && block !== leaves[0]) return '';
  if (/^\s*[(\[]?[0-9०-९]{1,3}[.)\]]/.test(item.textContent)) return '';
  const items = [...list.children].filter((child) => child.tagName === 'LI');
  return (parseInt(list.getAttribute('start') || '1', 10) + items.indexOf(item)) + '. ';
}

/** Cuts a section's text into sentences; fills pg.lines / pg.segs (one entry per sentence, each with its Range). */
function indexSentences(pg, section) {
  const leafBlocks = [...section.querySelectorAll(BLOCK_SELECTOR)].filter((block) => !block.querySelector(BLOCK_SELECTOR));
  const lines = [];
  for (const block of leafBlocks) {
    const map = textNodeMap(block);
    const prefix = listPrefix(block);
    splitSentences(block.textContent).forEach((part, n) => {
      const range = rangeFor(map, part.start, part.end);
      if (range) lines.push({ text: (n === 0 ? prefix : '') + part.text, source: 'docx', range, seg: lines.length });
    });
  }
  pg.lines = lines;
  pg.segs = lines.map((line, index) => ({ text: line.text, lines: [index] }));
  pg.garbled = looksGarbled(lines);        // an old Hindi font (Kruti Dev...) shows up as Latin gibberish
}

/** Replaces the page list with the sections of a Word document. @returns the number of sections */
export function buildDocxPages(html) {
  clearPdfPages();

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((node) => node.remove());

  const groups = [];
  let current = [];
  let chars = 0;
  for (const node of [...parsed.body.children]) {
    current.push(node);
    chars += node.textContent.length;
    if (current.length >= SECTION_BLOCKS || chars >= SECTION_CHARS) { groups.push(current); current = []; chars = 0; }
  }
  if (current.length || !groups.length) groups.push(current);

  groups.forEach((nodes, index) => {
    const pg = createDocxPage(index + 1);
    const section = document.createElement('section');
    section.className = 'docx-section';
    section.dataset.page = pg.num;
    nodes.forEach((node) => section.appendChild(node));
    el.pages.appendChild(section);
    pg.wrap = section;
    pg.textLayer = section;
    indexSentences(pg, section);
    state.pages.push(pg);
  });
  applyDocxZoom();
  return groups.length;
}

// --- tapping a sentence ---------------------------------------------------------------------------------------------

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

function onTap(event) {
  if (state.docKind !== 'docx') return;
  if (event.target.closest('a')) event.preventDefault();             // links in the document do not navigate
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;                    // the user is selecting text, not tapping
  const section = event.target.closest('.docx-section');
  const pg = section && state.pages[parseInt(section.dataset.page, 10) - 1];
  const caret = pg && caretAt(event.clientX, event.clientY);
  if (!caret) return;
  const sentence = pg.lines.findIndex((line) => line.range.comparePoint(caret.node, caret.offset) === 0);
  if (sentence >= 0) emit('line:tap', { page: pg.num, seg: sentence, offset: 0 });
}

// --- highlight, zoom ------------------------------------------------------------------------------------------------

const highlights = () => (window.CSS && CSS.highlights) || null;

/** Highlights sentence `s` of a Word section and scrolls it to the middle of the screen. */
export function showDocxHighlight(pg, s) {
  const range = pg.lines[s] && pg.lines[s].range;
  if (!range) return;
  const registry = highlights();
  if (registry) registry.set(HIGHLIGHT, new Highlight(range));
  const rect = range.getBoundingClientRect();
  window.scrollBy({ top: rect.top - window.innerHeight * 0.4, behavior: 'smooth' });
}

export function clearDocxHighlight() {
  const registry = highlights();
  if (registry) registry.delete(HIGHLIGHT);
}

/** Zoom = font size. Keeps the text at the same place on screen. */
export function applyDocxZoom() {
  const probe = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.4);
  const before = probe ? probe.getBoundingClientRect().top : 0;
  el.pages.style.setProperty('--docx-zoom', String(state.zoom));
  if (probe && probe.isConnected) window.scrollBy(0, probe.getBoundingClientRect().top - before);
}

export function initDocxView() {
  el.pages.addEventListener('click', onTap);
}
