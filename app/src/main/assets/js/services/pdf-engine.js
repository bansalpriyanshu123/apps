// Loads pdf.js (bundled inside the Android app, CDN elsewhere) and opens documents with it.

import { IN_ANDROID_APP, PDFJS_CDN } from '../core/config.js';

let library = null;
let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('failed ' + src)); };
    document.head.appendChild(script);
  });
}

async function load() {
  let base = PDFJS_CDN;
  if (IN_ANDROID_APP) {
    try {
      await loadScript('pdfjs/pdf.min.js');
      await loadScript('pdfjs/pdf.worker.min.js');
      base = 'pdfjs/';
    } catch (err) {
      await loadScript(PDFJS_CDN + 'pdf.min.js');           // bundled copy missing: fall back to the CDN
      await loadScript(PDFJS_CDN + 'pdf.worker.min.js');
    }
  } else {
    await loadScript(PDFJS_CDN + 'pdf.min.js');
    await loadScript(PDFJS_CDN + 'pdf.worker.min.js');
  }
  library = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  library.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  return library;
}

/** Starts loading pdf.js (once). Resolves to the library, rejects if it cannot be loaded. */
export function loadPdfEngine() {
  if (!loading) loading = load();
  return loading;
}

/** pdf.js's matrix multiply, needed to position text. Only valid after loadPdfEngine() resolved. */
export const transformMatrix = (a, b) => library.Util.transform(a, b);

export async function openDocument(arrayBuffer) {
  const lib = await loadPdfEngine();
  return lib.getDocument({ data: arrayBuffer }).promise;
}

/** pdf.js's operator codes (OPS.showText ...), needed to read a page's drawing instructions. */
export const pdfOps = () => library.OPS;
