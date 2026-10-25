// Opening a PDF: the Open button, the empty-state drop zone, drag and drop, and showing the new document.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { PREF } from '../core/config.js';
import { loadPref } from '../core/store.js';
import { loadPdfEngine, openDocument } from '../services/pdf-engine.js';
import { buildPages } from '../viewer/page-list.js';
import { goToPage, showPager } from '../viewer/pager.js';
import { showZoomControl } from '../viewer/zoom.js';
import { showIdle, showNowBar } from '../player/now-bar.js';
import { stop } from '../player/playback.js';
import { syncBarHeight } from '../ui/header.js';
import { setNotice } from '../ui/notice.js';

const looksLikePdf = (file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);

export async function openFile(file) {
  if (!file) return;
  if (!looksLikePdf(file)) { setNotice('That file is not a PDF. Choose a .pdf file.', true); return; }

  stop();
  setNotice('Opening ' + file.name + '…', false);
  try {
    await loadPdfEngine();
  } catch (err) {
    setNotice('The PDF engine did not load. Check your internet connection and reload.', true);
    return;
  }

  try {
    const bytes = await file.arrayBuffer();
    if (state.pdfDoc) { try { state.pdfDoc.destroy(); } catch (err) { /* already gone */ } }
    state.pdfDoc = await openDocument(bytes);
    state.pdfId = file.name + ':' + file.size + ':' + state.pdfDoc.numPages;
    state.docVisualOrder = false;          // a new PDF starts without assumptions about its text layer
    state.resumePos = null;

    el.banner.classList.remove('show');
    el.empty.style.display = 'none';
    el.pages.style.display = 'flex';
    showNowBar();
    showIdle();
    showZoomControl();
    showPager(state.pdfDoc.numPages);
    syncBarHeight();
    await buildPages();

    const saved = parseInt(loadPref(PREF.position(state.pdfId), '1'), 10) || 1;
    if (saved > 1 && saved <= state.pdfDoc.numPages) {
      goToPage(saved, false);
      setNotice('Resumed at page ' + saved + ' of ' + state.pdfDoc.numPages + '.', false);
    } else {
      const total = state.pdfDoc.numPages;
      setNotice(total + (total === 1 ? ' page' : ' pages') + '. Press ▶ or tap a line to listen.', false);
      window.scrollTo({ top: 0 });
    }
  } catch (err) {
    setNotice('Could not open this PDF: ' + (err && err.message ? err.message : err), true);
  }
}

export function initOpenPdf() {
  const choose = () => el.fileInput.click();
  el.openBtn.addEventListener('click', choose);
  el.empty.addEventListener('click', choose);
  el.empty.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
  });
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
