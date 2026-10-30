// Finding a phrase in a page's lines. Pure: unit-testable.
//
// Matching ignores case, the invisible joiners Hindi text carries (ZWJ / ZWNJ), repeated spaces and Unicode
// composition differences, so what is typed on a phone keyboard finds what the document contains.

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

export function normalizeForSearch(text) {
  return String(text).normalize('NFC').replace(INVISIBLE, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param lines  [{ text }] of one page, in reading order
 * @returns      indices of the lines the phrase is on; a phrase that wraps onto the next line is reported at the
 *               line it starts on. A line is reported once however many times the phrase occurs in it.
 */
export function findLines(lines, query) {
  const needle = normalizeForSearch(query);
  if (!needle) return [];
  const texts = lines.map((line) => normalizeForSearch(line.text));
  const found = [];
  texts.forEach((text, index) => {
    if (text.includes(needle)) { found.push(index); return; }
    const next = texts[index + 1];
    if (next !== undefined && (text + ' ' + next).includes(needle) && !next.includes(needle)) found.push(index);
  });
  return found;
}
