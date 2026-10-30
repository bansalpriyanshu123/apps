// Groups a page's lines into speakable sentences. Pure: unit-testable in Node.
//
// Reading line by line chops sentences in the middle and sounds robotic; reading whole paragraphs makes tapping
// imprecise. A "sentence" here is the run of lines up to the next full stop / bullet / short line.

const SENTENCE_END = /[।॥.?!]["'”’)\]]*$/;
const LIST_ITEM = /^(?:[•●○▪·*\-–—]\s|\(?[0-9०-९]{1,3}[.)]\s)/;
const MAX_SENTENCE_CHARS = 280;
// a vowel sign / anusvara / virama never starts a word: a line that begins with one continues the word of the line before
const CONTINUES_WORD = /^[ऀ-ःऺ-्॑-ॗॢॣ]/;

/** Joins line texts with a space, except where the next line continues a word. */
const joinLines = (texts) => texts.reduce((all, text) => (all === '' ? text : all + (CONTINUES_WORD.test(text) ? '' : ' ') + text), '');

/**
 * Splits lines into sentences. Sets `line.seg` (index of the sentence a line belongs to) on every line.
 * @param lines  [{ text, top, height, width }] in reading order
 * @returns      [{ text, lines: [indices into `lines`] }]
 */
export function buildSentences(lines) {
  const sentences = [];
  let current = null;
  let previous = null;
  // A wrapped line runs nearly the full width; a much shorter line ends its paragraph / heading / list item.
  const widest = lines.reduce((max, line) => Math.max(max, line.width), 0);

  lines.forEach((line, index) => {
    const shortPrevious = previous && previous.width < widest * 0.6;
    const bigGap = current && previous && (line.top - (previous.top + previous.height)) > previous.height * 0.9;
    // a bullet or numbered item starts its own sentence even when the line before has no full stop
    if (current && (bigGap || shortPrevious || LIST_ITEM.test(line.text) || current.text.length > MAX_SENTENCE_CHARS)) {
      sentences.push(current);
      current = null;
    }
    if (!current) current = { text: '', lines: [] };
    current.text = joinLines([current.text, line.text]);
    current.lines.push(index);
    line.seg = sentences.length;
    previous = line;
    if (SENTENCE_END.test(line.text)) { sentences.push(current); current = null; }
  });
  if (current) sentences.push(current);
  return sentences;
}

/** The text of a sentence, starting `from` lines into it (a tap on a later line starts mid-sentence). */
export const sentenceText = (lines, sentence, from = 0) =>
  joinLines(sentence.lines.slice(from).map((index) => lines[index].text));
