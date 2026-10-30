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
  const corrected = [];
  for (const item of items) {
    const str = item.str;
    let out = '';
    let i = 0;
    while (i < str.length) {
      while (next < glyphs.length && glyphs[next].unicode === '') out += textOf(glyphs[next++]);
      const glyph = glyphs[next];
      if (glyph && str.startsWith(glyph.unicode, i)) {
        out += textOf(glyph);
        i += glyph.unicode.length;
        next++;
      } else if (glyph && BLANK.test(glyph.unicode)) {
        // a space glyph: pdf.js either turned it into a plain space (a tab becomes one) or left it out at the end /
        // start of a line. Either way the word really ends here.
        if (/\s/.test(str[i])) i++;
        out += ' ';
        next++;
      } else if (str[i] === ' ') {
        if (!dropInsertedSpaces) out += ' ';
        i++;
      } else {
        return null;
      }
    }
    const fixed = out === str ? item : { ...item, str: out };
    corrected.push(dropInsertedSpaces ? { ...fixed, exactSpaces: true } : fixed);
  }
  return corrected;
}

/** Do the words of this page come with real space glyphs (so every other space pdf.js reports is an artefact)? */
export function usesSpaceGlyphs(glyphs) {
  if (glyphs.length < 20) return false;
  return glyphs.filter((glyph) => glyph.unicode === ' ').length / glyphs.length >= 0.05;
}
