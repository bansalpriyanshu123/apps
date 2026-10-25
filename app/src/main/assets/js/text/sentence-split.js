// Splits running text (a Word paragraph, a heading, a table cell) into speakable sentences. Pure: unit-testable.
//
// PDFs give us lines with positions, so text/sentences.js groups lines. Word files give us real paragraphs of text,
// so here we cut by punctuation instead. Results point back into the original string (start/end offsets), because the
// Word viewer needs to highlight exactly that part of the page.

const MAX_SENTENCE_CHARS = 280;

// Danda / double danda / ? / ! end a sentence wherever they are followed by space or the end; a full stop only when the
// next word does not start in lower case or with a digit ("4.2", "e.g. text", "डॉ. शर्मा" stay together).
const HARD_END = /[।॥?!]["'”’)\]]*(?=\s|$)/g;
const FULL_STOP = /\.["'”’)\]]*(?=\s+[^\sa-z0-9]|\s*$)/g;

/**
 * @returns [{ start, end, text }] - `text` is `source.slice(start, end)`, trimmed; empty pieces are dropped
 */
export function splitSentences(source, maxChars = MAX_SENTENCE_CHARS) {
  const cuts = new Set([source.length]);
  for (const pattern of [HARD_END, FULL_STOP]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) cuts.add(match.index + match[0].length);
  }
  const ordered = [...cuts].sort((a, b) => a - b);

  const sentences = [];
  let from = 0;
  for (const cut of ordered) {
    pushTrimmed(sentences, source, from, cut, maxChars);
    from = cut;
  }
  return sentences;
}

function pushTrimmed(out, source, from, to, maxChars) {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  while (end - start > maxChars) {
    // too long to read as one unit: cut at the last comma / semicolon / space that fits
    const chunk = source.slice(start, start + maxChars);
    let at = Math.max(chunk.lastIndexOf(','), chunk.lastIndexOf(';'), chunk.lastIndexOf('–'));
    if (at < maxChars * 0.4) at = chunk.lastIndexOf(' ');
    if (at <= 0) at = maxChars - 1;
    out.push({ start, end: start + at + 1, text: source.slice(start, start + at + 1).trim() });
    start += at + 1;
    while (start < end && /\s/.test(source[start])) start++;
  }
  if (end > start) out.push({ start, end, text: source.slice(start, end) });
}
