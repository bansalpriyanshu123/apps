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
      str: repairItem(item.str, visualOrder, item.kinds), x: m[4], y: m[5], w: (item.width || 0) * viewport.scale, h: height,
      exact: !!item.exactSpaces      // all spaces of this chunk are real space glyphs: none is added from the gap between chunks
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

  return orderRows(rows, findGutters(rows)).map(toLine).filter(Boolean);
}

// --- columns ----------------------------------------------------------------------------------------------------------
// A column gutter is a vertical corridor with no text in it for many rows in a row, with text on both sides. Word spaces
// (even wide ones in justified text) never line up over that many rows, and a short label followed by text does not
// last long enough, so only real columns qualify.

const MIN_GUTTER_ROWS = 5;      // rows the corridor must stay empty
const MIN_SIDE_ROWS = 4;        // rows whose text must reach the corridor, on each side of it
const EDGE_EM = 2.5;            // "reach": within this many line heights of the corridor
const MIN_GUTTER_EM = 0.9;      // narrowest corridor, in line heights (a bullet and its text are closer than that)

const overlapOf = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/** Free x ranges of a row; the two ends are open (`first` marks the leading one so margins can be told apart). */
const solid = (row) => row.chunks.filter((c) => c.str.trim());       // blank chunks (pdf.js emits spaces) hold no text

function gapsOf(row) {
  const spans = solid(row).map((c) => [c.x, c.x + c.w]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let end = -Infinity;
  for (const [from, to] of spans) {
    if (from > end) gaps.push([end, from]);
    end = Math.max(end, to);
  }
  gaps.push([end, Infinity]);
  return gaps;
}

/** @returns [{ from, to, left, right }]: y range and x corridor of every column gutter on the page */
function findGutters(rows) {
  const gutters = [];
  let active = [];
  const close = (candidate) => {
    const run = rows.slice(candidate.first, candidate.last + 1);
    if (run.length < MIN_GUTTER_ROWS) return;
    const [left, right] = candidate.range;
    const em = run.reduce((sum, row) => sum + row.h, 0) / run.length;
    if (right - left < em * MIN_GUTTER_EM) return;
    // lines on both sides must reach right up to the corridor; a run of short lines in the middle of a column does not
    const reach = em * EDGE_EM;
    const leftRows = run.filter((row) => solid(row).some((c) => c.x + c.w <= left + 1 && c.x + c.w >= left - reach)).length;
    const rightRows = run.filter((row) => solid(row).some((c) => c.x >= right - 1 && c.x <= right + reach)).length;
    if (leftRows < MIN_SIDE_ROWS || rightRows < MIN_SIDE_ROWS) return;
    // rows just above / below the run that do not cross the corridor belong to the columns too (a one-sided first line)
    const free = (row) => !solid(row).some((c) => overlapOf([c.x, c.x + c.w], [left, right]) > 0);
    let first = candidate.first;
    let last = candidate.last;
    while (first > 0 && free(rows[first - 1])) first--;
    while (last < rows.length - 1 && free(rows[last + 1])) last++;
    gutters.push({ from: rows[first].y - rows[first].h, to: rows[last].y, left, right });
  };

  rows.forEach((row, index) => {
    const gaps = gapsOf(row);
    const next = [];
    for (const candidate of active) {
      const em = row.h * MIN_GUTTER_EM;
      const gap = gaps.find((g) => overlapOf(g, candidate.range) >= Math.max(em, 1));
      if (gap) {
        candidate.range = [Math.max(gap[0], candidate.range[0]), Math.min(gap[1], candidate.range[1])];
        candidate.last = index;
        next.push(candidate);
      } else {
        close(candidate);
      }
    }
    for (const gap of gaps) {          // new corridors can only start between two pieces of text in this row
      if (!isFinite(gap[0]) || !isFinite(gap[1]) || gap[1] - gap[0] < Math.max(row.h * MIN_GUTTER_EM, 1)) continue;
      if (next.some((c) => overlapOf(c.range, gap) >= 0.6 * (gap[1] - gap[0]))) continue;
      next.push({ range: gap, first: index, last: index });
    }
    active = next;
  });
  active.forEach(close);
  return gutters;
}

/** Gutters that overlap in height form one block of columns; the same corridor found twice is kept once. */
function blocksOf(gutters) {
  const blocks = [];
  for (const gutter of [...gutters].sort((a, b) => a.from - b.from)) {
    const block = blocks.find((b) => gutter.from <= b.to && gutter.to >= b.from);
    if (!block) { blocks.push({ from: gutter.from, to: gutter.to, corridors: [[gutter.left, gutter.right]] }); continue; }
    block.from = Math.min(block.from, gutter.from);
    block.to = Math.max(block.to, gutter.to);
    const same = block.corridors.find((c) => overlapOf(c, [gutter.left, gutter.right]) > 0);
    if (same) { same[0] = Math.max(same[0], gutter.left); same[1] = Math.min(same[1], gutter.right); } else block.corridors.push([gutter.left, gutter.right]);
  }
  blocks.forEach((b) => b.corridors.sort((x, y) => x[0] - y[0]));
  return blocks;
}

/**
 * Reading order: rows top to bottom; inside a block of columns, the whole first column, then the next one, and so on.
 * A single-column page comes out exactly as it went in.
 */
function orderRows(rows, gutters) {
  const blocks = blocksOf(gutters);
  const ordered = [];
  let open = null;                                   // { block, columns: [[piece...]] }
  const flush = () => {
    if (open) for (const column of open.columns) if (column) ordered.push(...column);
    open = null;
  };
  for (const row of rows) {
    const block = blocks.find((b) => row.y >= b.from && row.y <= b.to);
    if (!block) { flush(); ordered.push(...piecesOf(row.chunks, row)); continue; }
    if (open && open.block !== block) flush();
    if (!open) open = { block, columns: [] };
    const byColumn = new Map();
    for (const chunk of row.chunks) {
      const centre = chunk.x + chunk.w / 2;
      const column = block.corridors.filter((c) => (c[0] + c[1]) / 2 < centre).length;
      if (!byColumn.has(column)) byColumn.set(column, []);
      byColumn.get(column).push(chunk);
    }
    for (const [column, chunks] of byColumn) (open.columns[column] ||= []).push(...piecesOf(chunks, row));
  }
  flush();
  return ordered;
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
