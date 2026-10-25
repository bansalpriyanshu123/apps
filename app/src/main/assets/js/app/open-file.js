// Opening a document: the Open button, the empty-state drop zone, drag and drop. Handles PDF and Word (.docx) files.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { PREF } from '../core/config.js';
import { loadPref } from '../core/store.js';
import { docxToHtml } from '../services/docx-engine.js';
import { loadPdfEngine, openDocument } from '../services/pdf-engine.js';
import { buildDocxPages } from '../viewer/docx-view.js';
import { buildPages } from '../viewer/page-list.js';
import { goToPage, showPager } from '../viewer/pager.js';
import { showZoomControl } from '../viewer/zoom.js';
import { showIdle, showNowBar } from '../player/now-bar.js';
import { stop } from '../player/playback.js';
import { syncBarHeight } from '../ui/header.js';
import { setNotice } from '../ui/notice.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isPdf = (file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
const isDocx = (file) => file.type === DOCX_MIME || /\.docx$/i.test(file.name);
const isOldWord = (file) => file.type === 'application/msword' || /\.doc$/i.test(file.name);

/** Reads a PDF. @returns { doc, id, build } - `build` creates the pages once the document is shown */
async function readPdf(file) {
  try {
    await loadPdfEngine();
  } catch (err) {
    throw new Error('The PDF engine did not load. Check your internet connection and reload.');
  }
  const doc = await openDocument(await file.arrayBuffer());
  return { doc, id: file.name + ':' + file.size + ':' + doc.numPages, build: buildPages };
}

/** Reads a Word file. Its "pages" are sections of the converted text, so the page count is known after `build`. */
async function readDocx(file) {
  let html;
  try {
    html = await docxToHtml(await file.arrayBuffer());
  } catch (err) {
    throw new Error('Could not read this Word file: ' + (err && err.message ? err.message : err));
  }
  const doc = { numPages: 0, destroy() {} };
  return {
    doc,
    id: file.name + ':' + file.size + ':docx',
    build: async () => { doc.numPages = buildDocxPages(html); }
  };
}

export async function openFile(file) {
  if (!file) return;
  const kind = isPdf(file) ? 'pdf' : isDocx(file) ? 'docx' : null;
  if (!kind) {
    setNotice(isOldWord(file)
      ? 'Old Word files (.doc) are not supported. In Word choose Save As → Word Document (.docx) and open that.'
      : 'That file is not a PDF or a Word (.docx) file.', true);
    return;
  }

  stop();
  setNotice('Opening ' + file.name + '…', false);
  try {
    const opened = kind === 'pdf' ? await readPdf(file) : await readDocx(file);
    if (state.doc) { try { state.doc.destroy(); } catch (err) { /* already gone */ } }
    state.doc = opened.doc;
    state.docKind = kind;
    state.docId = opened.id;
    state.docVisualOrder = false;          // a new document starts without assumptions about its text layer
    state.resumePos = null;

    el.banner.classList.remove('show');
    el.empty.style.display = 'none';
    document.body.classList.remove('start');
    el.pages.style.display = 'flex';
    el.pages.classList.toggle('docx-mode', kind === 'docx');
    showNowBar();
    showIdle();
    showZoomControl();
    syncBarHeight();
    await opened.build();
    showPager(state.doc.numPages);

    const total = state.doc.numPages;
    const saved = parseInt(loadPref(PREF.position(state.docId), '1'), 10) || 1;
    if (saved > 1 && saved <= total) {
      goToPage(saved, false);
      setNotice('Resumed at ' + (kind === 'pdf' ? 'page ' : 'part ') + saved + ' of ' + total + '.', false);
    } else {
      const unit = kind === 'pdf' ? 'page' : 'part';
      setNotice(total + ' ' + unit + (total === 1 ? '' : 's') + '. Press ▶ or tap a ' + (kind === 'pdf' ? 'line' : 'sentence') + ' to listen.', false);
      window.scrollTo({ top: 0 });
    }
    if (state.pages.some((pg) => pg.kind === 'docx' && pg.garbled)) {
      setNotice('This Word file uses an old Hindi font (such as Kruti Dev), so its text is not real Hindi and cannot be read aloud. ' +
        'Re-save it with a Unicode font (Mangal, Nirmala UI, Noto Sans Devanagari).', true);
    }
  } catch (err) {
    setNotice(err && err.message ? err.message : 'Could not open this file: ' + err, true);
  }
}

export function initOpenFile() {
  const choose = () => el.fileInput.click();
  el.openBtn.addEventListener('click', choose);
  el.empty.querySelector('#startOpenBtn').addEventListener('click', choose);
  el.fileInput.addEventListener('change', () => { openFile(el.fileInput.files[0]); el.fileInput.value = ''; });

  ['dragenter', 'dragover'].forEach((type) => document.addEventListener(type, (event) => {
    event.preventDefault();
    el.empty.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((type) => document.addEventListener(type, (event) => {
    event.preventDefault();
    el.empty.classList.remove('drag');
  }));
  document.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) openFile(file);
  });
}
