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
