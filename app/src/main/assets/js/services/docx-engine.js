// Reads Word (.docx) files with mammoth.js: .docx -> clean HTML (headings, paragraphs, lists, tables, images).
// Like pdf.js, a copy is bundled inside the Android app (assets/mammoth/) and the CDN is the fallback.

import { IN_ANDROID_APP, MAMMOTH_CDN } from '../core/config.js';

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
  if (IN_ANDROID_APP) {
    try { await loadScript('mammoth/mammoth.browser.min.js'); } catch (err) { await loadScript(MAMMOTH_CDN); }
  } else {
    await loadScript(MAMMOTH_CDN);
  }
  library = window.mammoth;
  if (!library) throw new Error('mammoth did not load');
  return library;
}

/** Starts loading mammoth (once). Resolves to the library, rejects if it cannot be loaded. */
export function loadDocxEngine() {
  if (!loading) loading = load().catch((err) => { loading = null; throw err; });
  return loading;
}

/** @returns the document as an HTML string */
export async function docxToHtml(arrayBuffer) {
  const mammoth = await loadDocxEngine();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}
