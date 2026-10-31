// Using the table of known fonts (glyph-table-data.js) to put right the text of a PDF whose own glyph -> text map is wrong.
// Pure: unit-testable in Node.
//
// pdf.js reports, for every glyph drawn, the text its font's map gives it. For some PDFs that map is wrong although the
// page looks fine (the glyph drawn as ज is reported as ि). The table says what a glyph of a known font really is;
// glyphs are looked up by font name and glyph id, and the advance width has to agree so another build of the same font
// is never trusted by mistake.

import { GLYPH_TABLE } from './glyph-table-data.js';

const WIDTH_TOLERANCE = 3;          // advance widths are in 1/1000 em
const BLANK = /^[\s\u200B-\u200D\uFEFF]*$/;       // whitespace and zero-width joiners

/** "RMYNBY+Kokila" -> "Kokila" (PDF subset fonts carry a random six-letter prefix). */
export const baseFontName = (name) => String(name || '').replace(/^[A-Z]{6}\+/, '');

/** What glyph `glyphId` of the font really is, or null when the table does not know it (or the width disagrees). */
export function lookupGlyph(fontName, glyphId, width) {
  const font = GLYPH_TABLE[baseFontName(fontName)];
  const entry = font && font[glyphId];
  return entry && Math.abs(entry[1] - width) <= WIDTH_TOLERANCE ? entry[0] : null;
}

/**
 * Rebuilds the text items of a page from its glyphs.
 * @param items   pdf.js text items ({ str, ... }) in drawing order
 * @param glyphs  every glyph drawn on the page in the same order: { unicode, text } - `unicode` is what pdf.js
 *                reported for it, `text` what the table says it really is (null: keep `unicode`)
 * @param options.dropInsertedSpaces  pdf.js also puts a space where two glyphs are drawn far apart. On a page whose words
 *                are separated by real space glyphs those spaces are noise ("प्र ारंभ"): leave them out.
 * @returns new items with the corrected `str` (`exactSpaces` set when every space on the page is a real space glyph), or null when the items cannot be matched up with the glyphs (the caller
 *          then leaves the page as pdf.js produced it). pdf.js adds spaces between glyphs that sit far apart; those
 *          belong to no glyph and are kept.
 */
export function correctItems(items, glyphs, { dropInsertedSpaces = false } = {}) {
  const textOf = (glyph) => (glyph.text !== null && glyph.text !== undefined ? glyph.text : glyph.unicode);
  let next = 0;
  const parts = [];                       // per item: [{ text, glyph }] (glyph -1: a space pdf.js made up or turned into one)
  for (const item of items) {
    const str = item.str;
    const mine = [];
    let i = 0;
    while (i < str.length) {
      while (next < glyphs.length && glyphs[next].unicode === '') { mine.push({ text: textOf(glyphs[next]), glyph: next }); next++; }
      const glyph = glyphs[next];
      if (glyph && str.startsWith(glyph.unicode, i)) {
        mine.push({ text: textOf(glyph), glyph: next });
        i += glyph.unicode.length;
        next++;
      } else if (glyph && BLANK.test(glyph.unicode)) {
        // a space glyph: pdf.js either turned it into a plain space (a tab becomes one) or left it out at the end /
        // start of a line. Either way the word really ends here.
        if (/\s/.test(str[i])) i++;
        mine.push({ text: ' ', glyph: next });
        next++;
      } else if (str[i] === ' ') {
        if (!dropInsertedSpaces) mine.push({ text: ' ', glyph: -1 });
        i++;
      } else {
        return null;
      }
    }
    parts.push(mine);
  }
  moveStrayGlyphs(items, parts, glyphs);
  return items.map((item, n) => {
    const text = parts[n].map((part) => part.text).join('');
    const width = drawnWidth(item, parts[n], glyphs);
    const fixed = text === item.str && width === item.width ? item : { ...item, str: text, width };
    return dropInsertedSpaces ? { ...fixed, exactSpaces: true } : fixed;
  });
}

/**
 * How wide the item is really drawn. pdf.js's own `width` can be far too small (20% on some PDFs), so the box of a line
 * built from it ends before the last words. The glyphs' advances (plus character spacing and the kerning numbers) give
 * the true width; it is only trusted when it is in the neighbourhood of pdf.js's figure.
 */
function drawnWidth(item, itemParts, glyphs) {
  const used = itemParts.filter((part) => part.glyph >= 0).map((part) => glyphs[part.glyph]);
  while (used.length && BLANK.test(used[used.length - 1].unicode)) used.pop();       // the space after the last word is no ink
  const scale = Math.abs(item.transform && item.transform[0]);
  if (!used.length || !scale || !item.width || used.some((glyph) => !glyph.glyph || !glyph.size)) return item.width;
  const size = used[0].size;
  let em = 0;                                   // advance in ems
  for (const glyph of used) em += glyph.glyph.width / 1000 - (glyph.adjust || 0) / 1000 + (glyph.charSpacing || 0) / size;
  const width = em * scale;
  return width > item.width * 0.9 && width < item.width * 1.6 ? width : item.width;
}

/**
 * pdf.js sometimes puts the first glyph(s) of a new line at the end of the item of the line above ("...आलोचनात्मक दृ" then
 * "ष्टि से ..."), although they are drawn at the start of the next line. They come from the same drawing instruction as the
 * start of the next item, which is on another line: move them over.
 */
function moveStrayGlyphs(items, parts, glyphs) {
  const run = (part) => (part.glyph >= 0 ? glyphs[part.glyph].run : undefined);
  for (let n = 0; n + 1 < items.length; n++) {
    const here = parts[n];
    const following = parts[n + 1];
    const realHere = here.filter((part) => part.glyph >= 0 && run(part) !== undefined);
    const firstOfNext = following.find((part) => part.glyph >= 0 && run(part) !== undefined);
    if (!realHere.length || !firstOfNext) continue;
    const lastRun = run(realHere[realHere.length - 1]);
    const lineHeight = Math.abs(items[n].height || items[n].transform[3] || 10);
    const otherLine = Math.abs(items[n].transform[5] - items[n + 1].transform[5]) > lineHeight * 0.5;
    if (!otherLine || lastRun !== run(firstOfNext) || lastRun === run(realHere[0])) continue;
    let from = here.length;
    while (from > 0 && (here[from - 1].glyph < 0 || run(here[from - 1]) === lastRun)) from--;
    const moved = here.splice(from).filter((part) => part.glyph >= 0);
    parts[n + 1] = moved.concat(following);
  }
}

/** Do the words of this page come with real space glyphs (so every other space pdf.js reports is an artefact)? */
export function usesSpaceGlyphs(glyphs) {
  if (glyphs.length < 20) return false;
  return glyphs.filter((glyph) => glyph.unicode === ' ').length / glyphs.length >= 0.05;
}
