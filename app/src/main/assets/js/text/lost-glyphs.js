// Putting back letters that a PDF's text layer lost, once we know WHAT each lost glyph was.
//
// Some PDFs (typically exported from browsers / Google Docs) draw Devanagari with ligature glyphs that have no entry
// in the font's text map, so pdf.js reports a NUL character for them. Each NUL stands for one of:
//   i        a ि matra, drawn BEFORE its consonant            -> goes after the consonant cluster that follows
//   reph     a lone र् mark, drawn after its syllable          -> goes before the cluster that precedes
//   reph+ii  one glyph that is both the र् mark and a ी        -> र् before the preceding cluster, ी after it
//   reph+o   one glyph that is both the र् mark and a ो        -> र् before, ो after (ों at the end of a word)
//   i+reph   one glyph that is both a ि and a र् mark, drawn    -> र् before the cluster that follows, ि after it
//            before its consonant (the "ि with a hat" of कर्ति)
// js/services/glyph-kinds.js works out the kind of every NUL from the page's drawing instructions; this module only
// does the (pure, unit-tested) text surgery. Unresolved placeholders are private-use characters so they can travel
// through line building and be resolved once the whole line is known.

import { CLUSTER, I_MATRA, II_MATRA, O_MATRA, ON_MATRA, RA, SIGNS, VIRAMA } from './devanagari-chars.js';

export const KIND = { I: 'i', REPH: 'reph', REPH_II: 'reph+ii', REPH_O: 'reph+o', I_REPH: 'i+reph' };

const MARK = {
  [KIND.I]: String.fromCharCode(0xE010),
  [KIND.REPH]: String.fromCharCode(0xE011),
  [KIND.REPH_II]: String.fromCharCode(0xE012),
  [KIND.REPH_O]: String.fromCharCode(0xE013),
  [KIND.I_REPH]: String.fromCharCode(0xE015)
};
const O_FINAL = String.fromCharCode(0xE014);     // ो or ों, decided by whether the word ends here
const ALL_MARKS = Object.values(MARK).concat(O_FINAL);
const NUL = String.fromCharCode(0);

const markClass = '[' + ALL_MARKS.join('') + ']';
const SENTENCE_BREAK = '$|[\\s,.;:!?)\\]\\-\\u2013\\u2014\\u0964\\u0965]';

/** The placeholder for a real ि that sits at the start of a chunk in screen order ("श" + "िक्त"). */
export const screenOrderIMatra = () => MARK[KIND.I];

/** True for a string made only of placeholders (a lone lost glyph that pdf.js reported as its own chunk). */
export const isMarkerOnly = (text) => text.length > 0 && [...text].every((ch) => ALL_MARKS.includes(ch));

/** Is this lost glyph attached to what comes before it (reph) or to what comes after it (ि)? */
export const attachesForward = (text) => text.length > 0 && [...text].every((ch) => ch === MARK[KIND.I] || ch === MARK[KIND.I_REPH]);

/**
 * Replaces each NUL in `str` with the placeholder of its kind.
 * @param kinds  one kind per NUL, in order
 * @returns the marked string, or null if the kinds do not match the NULs (the caller then falls back to guessing)
 */
export function markLostGlyphs(str, kinds) {
  let used = 0;
  let unknown = false;
  const marked = str.replace(/\x00/g, () => {
    const mark = MARK[kinds[used++]];
    if (!mark) unknown = true;
    return mark || '';
  });
  return unknown || used !== kinds.length ? null : marked;
}

/** Turns placeholders into letters, and removes any that could not be placed. Run on a whole line. */
export function resolveLostGlyphs(text) {
  let out = text.replace(new RegExp(NUL, 'g'), '');

  // reph (+ matra) after its syllable: र् goes in front of the last consonant cluster
  out = out.replace(new RegExp('(' + CLUSTER + ')(' + SIGNS + '*)' + MARK[KIND.REPH], 'g'), RA + VIRAMA + '$1$2');
  out = out.replace(new RegExp('(' + CLUSTER + ')' + MARK[KIND.REPH_II], 'g'), RA + VIRAMA + '$1' + II_MATRA);
  out = out.replace(new RegExp('(' + CLUSTER + ')' + MARK[KIND.REPH_O], 'g'), RA + VIRAMA + '$1' + O_FINAL);
  // ि + र् in one glyph, drawn before its consonant: र् goes before the cluster, ि after it
  out = out.replace(new RegExp(MARK[KIND.I_REPH] + '(' + CLUSTER + ')', 'g'), RA + VIRAMA + '$1' + I_MATRA);
  // ि drawn before its consonant: it belongs after the whole cluster
  out = out.replace(new RegExp(MARK[KIND.I] + '(' + CLUSTER + ')', 'g'), '$1' + I_MATRA);

  // ो in the middle of a word (सर्वोच्च), ों at the end of one (वर्षों, कार्यों)
  out = out.replace(new RegExp(O_FINAL + '(?=' + SENTENCE_BREAK + ')', 'g'), ON_MATRA);
  out = out.replace(new RegExp(O_FINAL, 'g'), O_MATRA);

  return out.replace(new RegExp(markClass, 'g'), '');
}
