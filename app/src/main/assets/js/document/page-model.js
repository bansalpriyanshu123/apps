// A "page" record and the things you can ask of it without touching the DOM.
//
// Pages are placeholders at first (all sized like page 1) and only fetch their real size and text when they come
// near the screen, so a 500-page PDF opens instantly.

import { state } from '../core/state.js';

/** @param first  pdf.js page 1 (already loaded) for n === 1, otherwise null */
export function createPage(num, first, base) {
  return {
    num,
    kind: 'pdf',
    page: num === 1 ? first : null,          // pdf.js page, once loaded
    base,                                    // unscaled viewport (page 1's size until the real one is known)
    pageLoad: num === 1 ? Promise.resolve(first) : null,
    vp: null,                                // viewport at the current scale
    // text
    pdfLines: null,                          // lines from pdf.js's own text layer
    ocr: null,                               // lines read by Gemini
    lines: [],                               // the lines in use: Gemini's if available, otherwise the PDF's
    segs: [],                                // sentences built from `lines`
    rawItems: null,
    textReady: null,                         // promise: text extracted and lines built
    garbled: false,                          // text is gibberish (old font encoding)
    damaged: false,                          // text has lost glyphs (missing matras)
    geminiState: 'idle',                     // 'idle' | 'pending' | 'done' | 'error'
    geminiPromise: null,
    linesLaidOut: false,
    // drawing (see viewer/renderer.js)
    rendered: false, rendering: null, renderTask: null, gen: 0, wantRender: false,
    // on-screen state
    visible: false, dwell: null,
    // DOM, filled in by viewer/page-list.js
    wrap: null, canvas: null, textLayer: null, badge: null
  };
}

/** Sets the viewport for the current scale and sizes the page's box accordingly. */
export function sizePage(pg) {
  pg.vp = pg.base.clone({ scale: state.scale });
  pg.wrap.style.width = pg.vp.width + 'px';
  pg.wrap.style.height = pg.vp.height + 'px';
}

/** Fetches the pdf.js page once; adopts the page's real size if it differs from the placeholder. */
export function loadPage(pg) {
  if (!pg.pageLoad) {
    pg.pageLoad = state.doc.getPage(pg.num).then((page) => {
      pg.page = page;
      const size = page.getViewport({ scale: 1 });
      if (Math.abs(size.width - pg.base.width) > 0.5 || Math.abs(size.height - pg.base.height) > 0.5) {
        pg.base = size;
        sizePage(pg);
      }
      return page;
    });
  }
  return pg.pageLoad;
}

/**
 * A section of a Word file. Word text is real Unicode and needs no repair or OCR, so a section is ready as soon as
 * it exists: `lines` holds one entry per sentence and `segs` maps each sentence to itself, which is all the player
 * needs. The DOM side (ranges, highlighting) is attached by viewer/docx-view.js.
 */
export function createDocxPage(num) {
  return {
    num,
    kind: 'docx',
    lines: [], segs: [],
    pdfLines: null, ocr: null, rawItems: null,
    textReady: Promise.resolve(),
    garbled: false, damaged: false,
    geminiState: 'done', geminiPromise: null,
    rendered: true, rendering: null, renderTask: null, gen: 0, wantRender: false,
    visible: false, dwell: null,
    wrap: null, canvas: null, textLayer: null, badge: null
  };
}
