import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSentences, sentenceText } from '../../app/src/main/assets/js/text/sentences.js';
import { groupLines } from '../../app/src/main/assets/js/text/line-grouping.js';
import { parseOcr } from '../../app/src/main/assets/js/text/ocr-parse.js';

const FULL = 400;
const line = (text, top, width = FULL) => ({ text, top, height: 14, width });

test('headings, bullets and paragraphs become separate sentences; wrapped lines stay together', () => {
  const lines = [
    line('भारतीय राजव्यवस्था', 0, 150),                          // short centred heading
    line('[ Indian Polity ]', 20, 100),
    line('यह एक लंबा अनुच्छेद है जो कई पंक्तियों में', 40),       // paragraph wrapped over three lines
    line('फैला हुआ है और इसमें कोई पूर्ण विराम नहीं है जब तक', 56),
    line('अंत में यह वाक्य समाप्त होता है।', 72, 260),
    line('• पहला बिंदु', 100, 120),
    line('• दूसरा बिंदु जो थोड़ा लंबा है और दो', 116),
    line('पंक्तियों में चलता है।', 132, 180),
    line('अगला अनुच्छेद नई पंक्ति से शुरू होता है।', 170)
  ];
  const sentences = buildSentences(lines);
  assert.deepEqual(sentences.map((s) => s.lines), [[0], [1], [2, 3, 4], [5], [6, 7], [8]]);
  assert.equal(lines[3].seg, 2);                                    // every line knows its sentence
});

test('tapping a later line of a sentence reads from that line to the end of the sentence', () => {
  const lines = [line('पहली पंक्ति जो आगे बढ़ती है', 0), line('दूसरी पंक्ति जो आगे बढ़ती है', 16), line('तीसरी पंक्ति समाप्त।', 32, 200)];
  const [sentence] = buildSentences(lines);
  assert.equal(sentenceText(lines, sentence), 'पहली पंक्ति जो आगे बढ़ती है दूसरी पंक्ति जो आगे बढ़ती है तीसरी पंक्ति समाप्त।');
  assert.equal(sentenceText(lines, sentence, 1), 'दूसरी पंक्ति जो आगे बढ़ती है तीसरी पंक्ति समाप्त।');
  assert.equal(sentenceText(lines, sentence, 2), 'तीसरी पंक्ति समाप्त।');
});

test('a very long run without punctuation is split so no sentence is unmanageable', () => {
  const lines = Array.from({ length: 12 }, (_, i) => line('यह लगभग पूरी चौड़ाई की एक पंक्ति है जिसमें विराम नहीं', i * 16));
  assert.ok(buildSentences(lines).length > 1);
});

test('groupLines joins chunks on one baseline, orders lines top to bottom, and spaces words but not conjuncts', () => {
  const identity = (viewport, item) => item;                         // item.transform is already in page coordinates
  const item = (str, x, y, width = 10) => ({ str, width, transform: [10, 0, 0, 10, x, y] });
  const lines = groupLines({
    items: [
      item('दूसरी', 20, 40), item('राजव्', 20, 20), item('यवस्था', 31, 20), item('भारत', 80, 20, 30),
      item('पंक्ति', 50, 40, 30)
    ],
    viewport: { transform: [1, 0, 0, 1, 0, 0], scale: 1 },
    transform: identity,
    visualOrder: false
  });
  assert.deepEqual(lines.map((l) => l.text), ['राजव्यवस्था भारत', 'दूसरी पंक्ति']);
  assert.ok(lines[0].top < lines[1].top);
  assert.ok(lines.every((l) => l.source === 'pdf' && l.width > 0 && l.height > 0));
});

test('parseOcr reads fenced JSON, normalises boxes and tolerates missing boxes', () => {
  const raw = '```json\n[{"text":"पहली पंक्ति","box_2d":[100,50,150,950]},{"text":"  दूसरी   पंक्ति "},{"text":""},{"line":"तीसरी","box_2d":[900,10,800,5]}]\n```';
  const lines = parseOcr(raw);
  assert.equal(lines.length, 3);                                    // the empty one is dropped
  assert.deepEqual(lines[0].b, [0.1, 0.05, 0.15, 0.95]);
  assert.equal(lines[1].text, 'दूसरी पंक्ति');                       // whitespace collapsed
  assert.ok(lines[1].b[0] > 0 && lines[1].b[2] > lines[1].b[0]);    // fallback strip
  assert.ok(lines[2].b[2] > lines[2].b[0] && lines[2].b[3] > lines[2].b[1]);   // inverted box repaired
  assert.throws(() => parseOcr('not json'), /valid JSON/);
  assert.throws(() => parseOcr('{"a":1}'), /list of lines|valid JSON/);
});

const identity = (viewport, item) => item;
const item = (str, x, y, width) => ({ str, width, transform: [10, 0, 0, 10, x, y] });
const page = (items) => groupLines({
  items, viewport: { transform: [1, 0, 0, 1, 0, 0], scale: 1, width: 400 }, transform: identity, visualOrder: false
}).map((l) => l.text);

test('groupLines keeps two columns apart: left column first, no line mixes text from both', () => {
  const rows = [0, 1, 2, 3, 4, 5, 6];
  const items = [item('मुख्य शीर्षक', 100, 10, 300)];                              // full-width title above the columns
  rows.forEach((n) => {
    items.push(item('बायाँ ' + n, 10, 40 + n * 20, 150));
    items.push(item('दायाँ ' + n, 173, 40 + n * 20 + (n % 2), 150));                // gutter of only 13px, baselines a pixel off
  });
  const expected = ['मुख्य शीर्षक', ...rows.map((n) => 'बायाँ ' + n), ...rows.map((n) => 'दायाँ ' + n)];
  assert.deepEqual(page(items), expected);
});

test('groupLines does not split a row for a wide word space, a label before text, or justified text', () => {
  const items = [];
  // justified text: the wide space lands at a different x in every row
  [0, 1, 2, 3, 4, 5, 6].forEach((n) => {
    const first = 40 + (n * 37) % 60;
    items.push(item('पहला' + n, 10, 20 + n * 20, first), item('दूसरा' + n, 10 + first + 20, 20 + n * 20, 60));
  });
  // a label with a gap before its text, over a few rows only
  items.push(item('लेबल:', 10, 200, 40), item('पाठ यहाँ', 100, 200, 60), item('लेबल दो:', 10, 220, 40), item('पाठ दो', 100, 220, 60));
  const lines = page(items);
  assert.equal(lines.length, 9);
  assert.ok(lines.every((text, i) => i >= 7 || text.includes('पहला') && text.includes('दूसरा')), lines.join(' | '));
  assert.deepEqual(lines.slice(7), ['लेबल: पाठ यहाँ', 'लेबल दो: पाठ दो']);
});

test('a line that starts with a vowel sign continues the word of the line before it', () => {
  const lines = [line('यह व्य', 0), line('ापार है।', 20)];
  const sentences = buildSentences(lines);
  assert.equal(sentences[0].text, 'यह व्यापार है।');
  assert.equal(sentenceText(lines, sentences[0]), 'यह व्यापार है।');
});

test('groupLines on pages with real space glyphs adds no space from chunk gaps, except for very wide ones (table columns)', () => {
  const exact = (str, x, width) => ({ str, width, transform: [10, 0, 0, 10, x, 20], exactSpaces: true });
  const text = (items) => groupLines({ items, viewport: { transform: [1, 0, 0, 1, 0, 0], scale: 1, width: 400 }, transform: (v, i) => i, visualOrder: false })[0].text;
  assert.equal(text([exact('सं', 10, 15), exact('रचना', 33, 30)]), 'संरचना');                 // 8 units apart: a drawing artefact
  assert.equal(text([exact('वर्ष', 10, 30), exact('देश', 120, 25)]), 'वर्ष देश');              // 80 units apart: another column
  assert.equal(text([exact('महत्त्वपूर्ण', 10, 60), exact(' सामाजिक', 71, 40)]), 'महत्त्वपूर्ण सामाजिक');   // a real space glyph
});

test('a bullet is separated from its text even on pages with real space glyphs', () => {
  const exact = (str, x, width) => ({ str, width, transform: [10, 0, 0, 10, x, 20], exactSpaces: true });
  const lines = groupLines({
    items: [exact('•', 10, 5), exact('बढ़ती', 15, 30)], viewport: { transform: [1, 0, 0, 1, 0, 0], scale: 1, width: 400 },
    transform: (v, i) => i, visualOrder: false
  });
  assert.equal(lines[0].text, '• बढ़ती');
});

test('reading order of a page with columns, a figure made of boxes, and columns again', () => {
  const items = [];
  const col = (prefix, x, from, count, y0) => { for (let n = 0; n < count; n++) items.push(item(prefix + (from + n), x, y0 + n * 20, 150)); };
  col('L', 10, 1, 6, 20);          // left column
  col('R', 173, 1, 6, 20);         // right column
  ['A', 'B', 'C'].forEach((box, b) => { for (let n = 1; n <= 4; n++) items.push(item(box + n, 10 + b * 110, 160 + n * 20, 80)); });   // a figure of three boxes
  col('L', 10, 7, 5, 300);         // columns again
  col('R', 173, 7, 5, 300);
  const expected = [
    ...[1, 2, 3, 4, 5, 6].map((n) => 'L' + n), ...[1, 2, 3, 4, 5, 6].map((n) => 'R' + n),
    'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4',
    ...[7, 8, 9, 10, 11].map((n) => 'L' + n), ...[7, 8, 9, 10, 11].map((n) => 'R' + n)
  ];
  assert.deepEqual(page(items), expected);
});

test('a small caption squeezed between two columns does not stop the columns being read one after the other', () => {
  const items = [];
  for (let n = 0; n < 24; n++) { items.push(item('बायाँ ' + n, 10, 20 + n * 20, 150)); items.push(item('दायाँ ' + n, 173, 20 + n * 20, 150)); }
  items.push(item('कैप्शन', 130, 233, 60));                     // 60 wide, reaches over the 13-unit gutter on both sides
  const lines = page(items);
  assert.equal(lines.indexOf('बायाँ 23') < lines.indexOf('दायाँ 0'), true, lines.join(' | '));
});

test('a single line is never cut into columns, however wide its word gaps', () => {
  assert.deepEqual(page([item('पहला', 10, 20, 60), item('दूसरा', 200, 20, 60)]), ['पहला दूसरा']);
});
