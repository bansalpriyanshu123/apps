// Reads a page from its picture with Gemini (for PDFs whose own text layer is garbled, lossy or missing).

import { settings } from '../core/store.js';
import { geminiCall, responseText } from './gemini-client.js';
import { parseOcr } from '../text/ocr-parse.js';

const PROMPT =
  'This image is one page of a document, mostly in Hindi (Devanagari). Transcribe every line of printed text ' +
  'exactly as it appears, in natural reading order (top to bottom; if there are columns, finish one column before the next). ' +
  'Use proper Unicode Devanagari. Do not translate, summarise, correct, or add anything. Skip page numbers and running headers only if they are isolated numbers. ' +
  'Return ONLY a JSON array, one element per printed line: {"text": "...", "box_2d": [ymin, xmin, ymax, xmax]} ' +
  'where the box is the tight bounding box of that line with coordinates normalised to 0–1000 of the image width and height.';

async function renderToJpeg(page) {
  const base = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(1600, Math.max(900, base.width * 2));
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/** @param page  a pdf.js page. @returns [{ text, b }] (see text/ocr-parse.js) */
export async function readPageWithGemini(page) {
  const request = {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'image/jpeg', data: await renderToJpeg(page) } },
      { text: PROMPT }
    ] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 16384 }
  };
  let data;
  try {
    // Low thinking keeps it fast and cheap; fall back to the defaults if the model rejects the field.
    data = await geminiCall(settings.textModel, {
      ...request,
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' }, ...request.generationConfig }
    });
  } catch (err) {
    if (err.status !== 400) throw err;
    data = await geminiCall(settings.textModel, request);
  }
  return parseOcr(responseText(data));
}
