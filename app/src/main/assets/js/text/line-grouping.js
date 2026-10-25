// Turns the loose text chunks pdf.js returns into reading lines with a position on the page.
// Pure: the pdf.js matrix helper is passed in, so this runs in Node as well.

import { repairItem, needsSpaceBetween, tidyLineText } from './devanagari.js';

/**
 * @param items        pdf.js text items ({ str, transform, width })
 * @param viewport     pdf.js viewport ({ transform, scale }) the lines should be positioned for
 * @param transform    pdfjsLib.Util.transform(m1, m2)
 * @param visualOrder  the PDF's text layer is in screen order (see repairItem)
 * @returns lines      [{ text, left, top, width, height, source: 'pdf' }] in CSS pixels, top to bottom
 */
export function groupLines({ items, viewport, transform, visualOrder }) {
  const chunks = items.map((item) => {
    const m = transform(viewport.transform, item.transform);
    const height = Math.hypot(m[2], m[3]) || 10;
    return { str: repairItem(item.str, visualOrder), x: m[4], y: m[5], w: (item.width || 0) * viewport.scale, h: height };
  });
  chunks.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  // chunks on (almost) the same baseline belong to one line
  const rows = [];
  for (const chunk of chunks) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(chunk.y - row.y) < Math.max(row.h, chunk.h) * 0.5) {
      row.chunks.push(chunk);
      row.h = Math.max(row.h, chunk.h);
    } else {
      rows.push({ y: chunk.y, h: chunk.h, chunks: [chunk] });
    }
  }

  const lines = [];
  for (const row of rows) {
    row.chunks.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = null;
    for (const chunk of row.chunks) {
      if (previousEnd !== null && needsSpaceBetween(text, chunk.str, chunk.x - previousEnd, row.h)) text += ' ';
      text += chunk.str;
      previousEnd = chunk.x + chunk.w;
    }
    text = tidyLineText(text);
    if (!text) continue;
    const left = Math.min(...row.chunks.map((c) => c.x));
    const right = Math.max(...row.chunks.map((c) => c.x + c.w));
    lines.push({
      text, left, top: row.y - row.h * 0.9, width: Math.max(right - left, row.h), height: row.h * 1.2, source: 'pdf'
    });
  }
  return lines;
}
