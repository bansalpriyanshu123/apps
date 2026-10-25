// Turns the loose text chunks pdf.js returns into reading lines with a position on the page.
// Pure: the pdf.js matrix helper is passed in, so this runs in Node as well.

import { repairItem, needsSpaceBetween, tidyLineText } from './devanagari.js';
import { attachesForward, isMarkerOnly } from './lost-glyphs.js';

/**
 * A lost glyph that pdf.js reported as a chunk of its own (a lone र् mark is drawn separately and slightly above
 * the line) is glued onto the neighbouring chunk it belongs to, so it cannot end up on a line of its own:
 *   ि    belongs to the chunk after it (it is drawn before its consonant)
 *   र्   belongs to the chunk before it (it is drawn after its syllable)
 */
function attachLoneMarkers(chunks) {
  const lone = chunks.filter((chunk) => isMarkerOnly(chunk.str));
  if (!lone.length) return chunks;
  const hosts = chunks.filter((chunk) => !isMarkerOnly(chunk.str));
  for (const marker of lone) {
    const near = hosts.filter((host) => Math.abs(host.y - marker.y) < Math.max(host.h, marker.h) * 2);
    if (attachesForward(marker.str)) {
      const next = near.filter((host) => host.x + host.w >= marker.x - 1).sort((a, b) => a.x - b.x)[0];
      if (next) next.str = marker.str + next.str;
    } else {
      // the syllable ends where the mark is drawn: the nearest chunk that ends at or before it (else one containing it)
      const tolerance = Math.max(1, marker.h * 0.3);
      const before = near.filter((host) => host.x + host.w <= marker.x + tolerance).sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
      const containing = near.find((host) => host.x <= marker.x && marker.x <= host.x + host.w);
      const target = before || containing;
      if (target) target.str += marker.str;
    }
  }
  return hosts;
}

/**
 * @param items        pdf.js text items ({ str, transform, width }), optionally with `kinds` (see lost-glyphs.js)
 * @param viewport     pdf.js viewport ({ transform, scale }) the lines should be positioned for
 * @param transform    pdfjsLib.Util.transform(m1, m2)
 * @param visualOrder  the PDF's text layer is in screen order (see repairItem)
 * @returns lines      [{ text, left, top, width, height, source: 'pdf' }] in CSS pixels, top to bottom
 */
export function groupLines({ items, viewport, transform, visualOrder }) {
  let chunks = items.map((item) => {
    const m = transform(viewport.transform, item.transform);
    const height = Math.hypot(m[2], m[3]) || 10;
    return {
      str: repairItem(item.str, visualOrder, item.kinds), x: m[4], y: m[5], w: (item.width || 0) * viewport.scale, h: height
    };
  });
  chunks = attachLoneMarkers(chunks);
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
