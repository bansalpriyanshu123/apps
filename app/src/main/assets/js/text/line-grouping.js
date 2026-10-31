// Turns the loose text chunks pdf.js returns into reading lines with a position on the page.
// Pure: the pdf.js matrix helper is passed in, so this runs in Node as well.

import { repairItem, needsSpaceBetween, tidyLineText } from './devanagari.js';
import { readingGroups } from './layout-order.js';
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
      str: repairItem(item.str, visualOrder, item.kinds), x: m[4], y: m[5], w: (item.width || 0) * viewport.scale, h: height,
      exact: !!item.exactSpaces      // all spaces of this chunk are real space glyphs: none is added from the gap between chunks
    };
  });
  chunks = attachLoneMarkers(chunks);

  // reading order: columns, figures and paragraphs are separated first (text/layout-order.js); inside each group the
  // chunks on (almost) the same baseline form one line
  const pieces = [];
  for (const group of readingGroups(chunks)) {
    group.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const rows = [];
    for (const chunk of group) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(chunk.y - row.y) < Math.max(row.h, chunk.h) * 0.5) {
        row.chunks.push(chunk);
        row.h = Math.max(row.h, chunk.h);
      } else {
        rows.push({ y: chunk.y, h: chunk.h, chunks: [chunk] });
      }
    }
    for (const row of rows) pieces.push(...piecesOf(row.chunks, row));
  }
  return pieces.map(toLine).filter(Boolean);
}

const EXACT_GAP_EM = 3;
const BULLET = /^\s*[•●○▪·◦■▪–—-]\s*$/;      // a bullet is followed by a space even where gaps add none
const LONE_NUMBER = /^\s*[0-9०-९]{1,3}\s*$/;
const PAGE_NUMBER_GAP_EM = 6;

/** A row's chunks as line pieces: a page number far to the right of the text ("...प्रारंभ      1") is a line of its own. */
function piecesOf(chunks, row) {
  chunks.sort((a, b) => a.x - b.x);
  const last = chunks[chunks.length - 1];
  const before = chunks[chunks.length - 2];
  if (before && LONE_NUMBER.test(last.str) && last.x - (before.x + before.w) > row.h * PAGE_NUMBER_GAP_EM) {
    return [pieceOf(chunks.slice(0, -1), row), pieceOf([last], row)];
  }
  return [pieceOf(chunks, row)];
}

function pieceOf(chunks, row) {
  chunks.sort((a, b) => a.x - b.x);
  return { y: row.y, h: row.h, chunks, left: chunks[0].x, right: Math.max(...chunks.map((c) => c.x + c.w)) };
}

/** A row piece -> a line with its text and box. */
function toLine(piece) {
  let text = '';
  let previousEnd = null;
  let previous = null;
  for (const chunk of piece.chunks) {
    const gap = previousEnd === null ? 0 : chunk.x - previousEnd;
    // where every space is a real space glyph only a very wide gap (a table column) still means a space
    const exact = previous && previous.exact && chunk.exact && gap < piece.h * EXACT_GAP_EM;
    if (previous && BULLET.test(previous.str) && !/\s$/.test(text) && !/^\s/.test(chunk.str)) text += ' ';
    else if (previousEnd !== null && !exact && needsSpaceBetween(text, chunk.str, gap, piece.h)) text += ' ';
    previous = chunk;
    text += chunk.str;
    previousEnd = chunk.x + chunk.w;
  }
  text = tidyLineText(text);
  if (!text) return null;
  return {
    text, left: piece.left, top: piece.y - piece.h * 0.9, width: Math.max(piece.right - piece.left, piece.h),
    height: piece.h * 1.2, source: 'pdf'
  };
}
