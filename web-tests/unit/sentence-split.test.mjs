import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../../app/src/main/assets/js/text/sentence-split.js';

const texts = (s, max) => splitSentences(s, max).map((p) => p.text);

test('Hindi sentences end at the danda, English at . ? !', () => {
  assert.deepEqual(texts('भारत एक देश है। यहाँ कई भाषाएँ बोली जाती हैं। क्या यह सच है? हाँ!'),
    ['भारत एक देश है।', 'यहाँ कई भाषाएँ बोली जाती हैं।', 'क्या यह सच है?', 'हाँ!']);
  assert.deepEqual(texts('The law is supreme. Is it? Yes!'), ['The law is supreme.', 'Is it?', 'Yes!']);
});

test('a full stop inside a number or an abbreviation does not end the sentence', () => {
  assert.deepEqual(texts('अनुच्छेद 4.2 में कहा गया है। अगला वाक्य।'), ['अनुच्छेद 4.2 में कहा गया है।', 'अगला वाक्य।']);
  assert.deepEqual(texts('See e.g. page nine. Then stop.'), ['See e.g. page nine.', 'Then stop.']);
});

test('offsets point back into the original string, so the viewer can highlight exactly that text', () => {
  const source = '  पहला वाक्य।   दूसरा वाक्य।  ';
  for (const part of splitSentences(source)) assert.equal(source.slice(part.start, part.end), part.text);
  assert.equal(splitSentences(source).length, 2);
});

test('text without punctuation is one sentence; blank text gives none', () => {
  assert.deepEqual(texts('एक शीर्षक बिना विराम चिह्न'), ['एक शीर्षक बिना विराम चिह्न']);
  assert.deepEqual(texts('   \n  '), []);
  assert.deepEqual(texts(''), []);
});

test('a very long run is cut at commas / spaces so no unit is unmanageable', () => {
  const long = Array.from({ length: 40 }, (_, i) => 'शब्द' + i).join(', ');
  const parts = splitSentences(long, 120);
  assert.ok(parts.length > 2);
  assert.ok(parts.every((p) => p.text.length <= 125), parts.map((p) => p.text.length).join(','));
  assert.equal(parts.map((p) => p.text).join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').replace(/ ,/g, ','));
});
