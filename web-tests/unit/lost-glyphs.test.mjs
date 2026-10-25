import test from 'node:test';
import assert from 'node:assert/strict';
import { repairItem, tidyLineText } from '../../app/src/main/assets/js/text/devanagari.js';
import { markLostGlyphs, KIND } from '../../app/src/main/assets/js/text/lost-glyphs.js';
import { groupLines } from '../../app/src/main/assets/js/text/line-grouping.js';

const NUL = String.fromCharCode(0);
const { I, REPH, REPH_II, REPH_O } = KIND;

// chunks: [text, kinds-of-its-NULs]; the chunks of one line are repaired, joined and tidied like groupLines does
const line = (...chunks) => tidyLineText(chunks.map(([text, kinds]) => repairItem(text, true, kinds)).join(''));

// Word shapes taken from a real PDF whose font lacks text-map entries for ligature glyphs. The kind of every NUL
// is what services/glyph-kinds.js derives from the page's glyphs (advance width + ink of the glyph).
test('र्+ी ligature glyph: one placeholder stands for both letters (प्रतिस्पर्धी, संघर्षी)', () => {
  assert.equal(line([' प्र'], [NUL + 'त', [I]], ['स्प'], ['ध' + NUL, [REPH_II]]), 'प्रतिस्पर्धी');
  assert.equal(line(['संघ'], ['ष' + NUL, [REPH_II]]), 'संघर्षी');
});

test('र्+ो ligature glyph is ो inside a word and ों at the end of one', () => {
  assert.equal(line(['स'], ['व' + NUL, [REPH_O]], ['च्च']), 'सर्वोच्च');
  assert.equal(line(['व'], ['ग' + NUL, [REPH_O]]), 'वर्गों');
  assert.equal(line(['का'], ['य' + NUL, [REPH_O]], [' के लिए']), 'कार्यों के लिए');
  assert.equal(line(['वर्ष'.slice(0, 1)], ['ष' + NUL, [REPH_O]], [', ']), 'वर्षों,');
});

test('plain र् glyph and ि glyph keep working next to the new kinds', () => {
  assert.equal(line(['का'], ['य' + NUL, [REPH]], ['पा'], [NUL + 'ल', [I]], ['का']), 'कार्यपालिका');
  assert.equal(line(['अ'], ['था' + NUL, [REPH]], ['त्']), 'अर्थात्');
  assert.equal(line(['सं'], [NUL + 'व', [I]], ['धान']), 'संविधान');
});

test('kinds that do not match the NULs make the chunk fall back to the position rules', () => {
  assert.equal(markLostGlyphs('ध' + NUL, [REPH_II, I]), null);          // two kinds, one NUL
  assert.equal(markLostGlyphs('ध' + NUL, [null]), null);                // unclassified glyph
  assert.equal(repairItem('ध' + NUL, true, [I, I]), 'र्ध');             // old rule: trailing NUL = reph
  assert.equal(repairItem('ध' + NUL, true, undefined), 'र्ध');
});

test('a lone र् glyph drawn as its own chunk, above the line, is glued back onto its syllable', () => {
  const at = (str, x, y, width = 10, kinds) => ({ str, width, kinds, transform: [10, 0, 0, 10, x, y] });
  const lines = groupLines({
    items: [at('अ', 10, 100), at('था', 20, 100, 20), at(NUL, 40, 92, 0, [REPH]), at('त्', 40, 100), at('आगे', 80, 100, 30)],
    viewport: { transform: [1, 0, 0, 1, 0, 0], scale: 1 },
    transform: (viewport, item) => item,
    visualOrder: true
  });
  // without the fix the lone chunk forms a line of its own and the र् is lost ("अथात्")
  assert.deepEqual(lines.map((l) => l.text), ['अर्थात् आगे']);
});
