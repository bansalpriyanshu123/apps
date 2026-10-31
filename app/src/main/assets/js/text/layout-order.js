// Reading order of the text chunks of one page. Pure: unit-testable.
//
// The classic "XY cut": look for the widest empty vertical corridor that runs through the WHOLE region (a column gutter)
// and split there, left part first; if there is none, split at the widest empty horizontal band (between paragraphs, above
// and below a figure) and read the upper part first; repeat on the parts. A page with a title, two columns, a figure
// made of five boxes and two more columns comes out as: the title, the left column, the right column, the figure
// box by box, the next left column, the next right column.
//
// Why the whole region and not "many rows": a corridor between two columns is free over every line of the region, while
// a word space in a justified paragraph, or the gap between a label and its text, is not. Regions are cut horizontally
// before they get small, so a single line is never cut vertically (a region needs MIN_ROWS lines to be split in columns).

const MIN_ROWS = 4;           // lines a region needs before it can be split into columns
const MIN_SIDE_ROWS = 2;      // lines each column must have
const GUTTER_EM = 0.4;        // narrowest column gutter, in line heights
const MIN_SIDE_EM = 3;        // each side of a gutter must be at least this wide (a bullet column is not a column)
const MIN_BAND_EM = 0.1;      // narrowest empty band between lines that can be cut, in line heights
const WIDE_SHARE = 0.4;       // a chunk this wide (share of the region's width) that spans a gutter is a title, not part of a column
const SPAN_EM = 1.5;          // a chunk reaching this far beyond a gutter on both sides spans it
const CROSSING_SHARE = 0.05;  // share of the lines whose chunk may poke into a gutter without spoiling it (none in a short region)

const isText = (chunk) => chunk.str.trim().length > 0;

/** Merges [from, to] intervals that overlap and returns them sorted. */
function mergeIntervals(intervals) {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** How many separate lines the chunks form (baselines closer than half a line height are one line). */
function countRows(chunks) {
  const ys = chunks.map((chunk) => chunk.y).sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  const gap = Math.max(1, median(chunks.map((chunk) => chunk.h)) * 0.5);
  for (const y of ys) {
    if (y - last > gap) rows++;
    last = y;
  }
  return rows;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 10;
}

/** The widest empty gap between merged intervals that is at least `min` wide, or null. */
function widestGap(intervals, min) {
  let best = null;
  for (let i = 1; i < intervals.length; i++) {
    const width = intervals[i][0] - intervals[i - 1][1];
    if (width >= min && (!best || width > best.width)) best = { width, from: intervals[i - 1][1], to: intervals[i][0] };
  }
  return best;
}

/**
 * The widest vertical corridor that at most `allowed` text chunks reach into. A few are allowed because a chunk's width
 * as pdf.js reports it can be too long and poke into the gutter although the text itself does not.
 */
function widestCorridor(text, min, allowed) {
  const edges = [...new Set(text.flatMap((chunk) => [chunk.x, chunk.x + chunk.w]))].sort((a, b) => a - b);
  let best = null;
  let start = null;
  const covering = (from, to) => text.reduce((n, chunk) => n + (chunk.x < to && chunk.x + chunk.w > from ? 1 : 0), 0);
  for (let i = 0; i + 1 < edges.length; i++) {
    const free = covering(edges[i], edges[i + 1]) <= allowed;
    if (free && start === null) start = edges[i];
    if ((!free || i + 2 === edges.length) && start !== null) {
      const end = free ? edges[i + 1] : edges[i];
      if (end - start >= min && start > edges[0] && end < edges[edges.length - 1] && (!best || end - start > best.to - best.from)) best = { from: start, to: end };
      start = null;
    }
  }
  return best;
}

function verticalCut(chunks, lineHeight) {
  const rows = countRows(chunks);
  if (rows < MIN_ROWS) return null;
  const text = chunks.filter(isText);
  const gap = widestCorridor(text, lineHeight * GUTTER_EM, Math.floor(rows * CROSSING_SHARE));
  if (!gap) return null;
  // a wide chunk that reaches well past the gutter on both sides (a title, a full-width caption) belongs to neither column:
  // cut around it horizontally first. A narrow one squeezed between the columns (a small caption) or one that only pokes
  // a little into the gutter is tolerated and goes with the side its centre is on.
  const margin = lineHeight * SPAN_EM;
  const regionWidth = Math.max(...text.map((chunk) => chunk.x + chunk.w)) - Math.min(...text.map((chunk) => chunk.x));
  if (text.some((chunk) => chunk.x < gap.from - margin && chunk.x + chunk.w > gap.to + margin && chunk.w > regionWidth * WIDE_SHARE)) return null;
  const middle = (gap.from + gap.to) / 2;
  const left = chunks.filter((chunk) => chunk.x + chunk.w / 2 < middle);
  const right = chunks.filter((chunk) => chunk.x + chunk.w / 2 >= middle);
  if (countRows(left.filter(isText)) < MIN_SIDE_ROWS || countRows(right.filter(isText)) < MIN_SIDE_ROWS) return null;
  // both sides must be real text, not a bullet column next to the text of its items
  const extent = (side) => Math.max(...side.filter(isText).map((chunk) => chunk.x + chunk.w)) - Math.min(...side.filter(isText).map((chunk) => chunk.x));
  if (extent(left) < lineHeight * MIN_SIDE_EM || extent(right) < lineHeight * MIN_SIDE_EM) return null;
  return [left, right];
}

function horizontalCut(chunks, lineHeight) {
  const text = chunks.filter(isText);
  const gap = widestGap(mergeIntervals(text.map((chunk) => [chunk.y - chunk.h * 0.85, chunk.y + chunk.h * 0.25])), lineHeight * MIN_BAND_EM);
  if (!gap) return null;
  const middle = (gap.from + gap.to) / 2;
  return [chunks.filter((chunk) => chunk.y < middle), chunks.filter((chunk) => chunk.y >= middle)];
}

/**
 * @param chunks  [{ str, x, y, w, h }] (y is the baseline, all in the same unit)
 * @returns       groups of chunks in reading order; each group is a run of lines that could not be cut any further
 */
export function readingGroups(chunks) {
  const lineHeight = median(chunks.filter(isText).map((chunk) => chunk.h));
  const groups = [];
  const cut = (region) => {
    if (region.length <= 1) { if (region.length) groups.push(region); return; }
    const parts = verticalCut(region, lineHeight) || horizontalCut(region, lineHeight);
    if (!parts || !parts[0].length || !parts[1].length) { groups.push(region); return; }
    parts.forEach(cut);
  };
  cut(chunks);
  return groups;
}
