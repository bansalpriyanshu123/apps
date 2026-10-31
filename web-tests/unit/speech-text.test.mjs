import test from 'node:test';
import assert from 'node:assert/strict';
import { forSpeech } from '../../app/src/main/assets/js/text/speech-text.js';
import { splitSentences } from '../../app/src/main/assets/js/text/sentence-split.js';

test('abbreviations are spoken in full', () => {
  assert.equal(forSpeech('उदा: संघवाद'), 'उदाहरण: संघवाद');
  assert.equal(forSpeech('उदा. भारत'), 'उदाहरण भारत');
  assert.equal(forSpeech('(उदा) संघ'), '(उदाहरण) संघ');
  assert.equal(forSpeech('Ex. The case'), 'example The case');
  assert.equal(forSpeech('Ex: the case'), 'example: the case');
  assert.equal(forSpeech('e.g. India'), 'for example India');
  assert.equal(forSpeech('i.e. that'), 'that is that');
  assert.equal(forSpeech('etc. and vs. them'), 'et cetera and versus them');
});

test('words that merely contain or start like an abbreviation are left alone', () => {
  for (const text of ['उदाहरण भारत', 'उदाहरणार्थ', 'ex-president', 'index.', 'example.', 'exam: soon', 'उदासीन']) {
    assert.equal(forSpeech(text), text);
  }
});

test('the number of a numbered point stays with its sentence', () => {
  assert.deepEqual(splitSentences('1. यह पहला बिंदु है। यह दूसरा वाक्य है।').map((p) => p.text), ['1. यह पहला बिंदु है।', 'यह दूसरा वाक्य है।']);
  assert.deepEqual(splitSentences('(2) अगला बिंदु: विवरण।').map((p) => p.text), ['(2) अगला बिंदु: विवरण।']);
  assert.deepEqual(splitSentences('३. तीसरा बिंदु। चौथा वाक्य।').map((p) => p.text), ['३. तीसरा बिंदु।', 'चौथा वाक्य।']);
});

test('the full stop of an abbreviation does not end a sentence', () => {
  assert.deepEqual(splitSentences('उदा. संघवाद में राज्य। दूसरा वाक्य।').map((p) => p.text), ['उदा. संघवाद में राज्य।', 'दूसरा वाक्य।']);
  assert.deepEqual(splitSentences('Ex. The Constitution applies. Next one.').map((p) => p.text), ['Ex. The Constitution applies.', 'Next one.']);
  assert.deepEqual(splitSentences('डॉ. शर्मा आए। फिर गए।').map((p) => p.text), ['डॉ. शर्मा आए।', 'फिर गए।']);
});
