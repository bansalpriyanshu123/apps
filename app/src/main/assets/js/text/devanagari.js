// Pure helpers for Devanagari text as it comes out of PDFs. No DOM, no application state: unit-testable in Node.

const NUL = '\x00';
const VIRAMA = '्';
const I_MATRA = 'ि';
const RA = 'र';

const CONS = '[\\u0915-\\u0939\\u0958-\\u095F]\\u093C?';               // a consonant, optional nukta
const CLUSTER_START = new RegExp('^(' + CONS + '(?:\\u094D' + CONS + ')*)');
const REPH_BASE = new RegExp(
  '((?:' + CONS + '\\u094D)*' + CONS + ')([\\u093E-\\u094C\\u0962\\u0963\\u0901-\\u0903]*)$');
const LOST_GLYPH = /[\x00\uFFFD]/;
const STARTS_WITH_SIGN = /^[ऀ-ःऺ-्॑-ॗॢॣ]/;

/** True if pdf.js returned a placeholder (NUL / U+FFFD) for a glyph it could not map to text. */
export const hasLostGlyphs = (items) => items.some((item) => LOST_GLYPH.test(item.str));

/**
 * Repairs one text chunk from a PDF whose font has no text map for some matras.
 *
 * Such PDFs draw the i-matra before its consonant and pdf.js reports a NUL where it was ("सं" + NUL+"व" for
 * संविधान), and a lost reph as a trailing NUL ("कार्य" arrives as "काय"+NUL). The NUL's position inside its chunk
 * says which it was:
 *   NUL at the START of a chunk -> a ि belonging after the chunk's leading consonant cluster
 *   NUL at the END of a chunk   -> a reph (र्) belonging before the chunk's last consonant cluster
 * A real ि at the start of a chunk is in screen order too ("श" + "िक्त" for शक्ति) and is moved the same way,
 * but only when `visualOrder` says this PDF behaves like that.
 * A glyph with no code at all (an empty chunk) cannot be recovered; Gemini reading handles those.
 */
export function repairItem(str, visualOrder) {
  let text = str.replace(/\uFFFD/g, '');
  if (text.indexOf(NUL) < 0 && !(visualOrder && text.charCodeAt(0) === I_MATRA.charCodeAt(0))) return text;

  let moveIMatra = false;
  let insertReph = false;
  if (text.charCodeAt(0) === 0) {
    moveIMatra = true;
    text = text.replace(/^\x00+/, '');
  } else if (visualOrder && text.charCodeAt(0) === I_MATRA.charCodeAt(0)) {
    moveIMatra = true;
    text = text.slice(1);
  }
  if (text.indexOf(NUL) >= 0) {
    insertReph = text.endsWith(NUL);
    text = text.replace(/\x00/g, '');
  }
  if (moveIMatra) {
    const cluster = CLUSTER_START.exec(text);
    if (cluster) text = cluster[1] + I_MATRA + text.slice(cluster[1].length);
  }
  if (insertReph) text = text.replace(REPH_BASE, RA + VIRAMA + '$1$2');
  return text;
}

/** Should a space be inserted between two chunks of one line that are `gap` apart? Never inside a word. */
export function needsSpaceBetween(textSoFar, nextChunk, gap, lineHeight) {
  if (!(gap > lineHeight * 0.12)) return false;
  if (/\s$/.test(textSoFar) || /^\s/.test(nextChunk)) return false;
  const insideWord = textSoFar.endsWith(VIRAMA) || STARTS_WITH_SIGN.test(nextChunk);
  return !insideWord;
}

/** Collapses whitespace and removes a space after a conjunct mark ("राजव् यवस् था" -> "राजव्यवस्था"). */
export function tidyLineText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/्\s+(?=[क-हक़-य़])/g, VIRAMA)
    .trim();
}

// --- is the text layer unusable? ---------------------------------------------------------------------------------

const ENGLISH_WORDS = new Set(
  'the and of to in is a that for it with as was on are by this be from or an at not have has but his her they you we which their were can will one all'.split(' '));

/**
 * Old Hindi fonts (Kruti Dev, Chanakya...) put Devanagari on Latin letters ("fganh Hkk"kk ds izfr..."), so the text
 * is mostly "letters" and passes the plain letter test. It differs from real English: about half of the words
 * have a capital or symbol inside them, and almost none are common English words.
 */
export function looksLikeLegacyHindi(text) {
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (words.length < 5) return false;
  let english = 0;
  let odd = 0;
  for (const word of words) {
    if (ENGLISH_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ''))) english++;
    if (/[a-z][A-Z]|[A-Za-z]["\[\];^{}~|@]|^[;\[{^~|@]/.test(word)) odd++;
  }
  return odd / words.length > 0.25 && english / words.length < 0.1;
}

/** True when the page's text is gibberish (symbols, or a legacy-font encoding) rather than readable text. */
export function looksGarbled(lines) {
  const text = lines.map((line) => line.text).join(' ');
  const chars = text.replace(/\s/g, '');
  if (chars.length < 20) return false;
  let letters = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    if ((code >= 0x0900 && code <= 0x097F) || (code >= 0x0980 && code <= 0x0DFF) || /[A-Za-z]/.test(ch)) letters++;
  }
  if (letters / chars.length < 0.6) return true;
  return looksLikeLegacyHindi(text);
}
