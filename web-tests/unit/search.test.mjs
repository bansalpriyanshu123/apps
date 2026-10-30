import test from 'node:test';
import assert from 'node:assert/strict';
import { findLines, normalizeForSearch } from '../../app/src/main/assets/js/text/search.js';

const lines = (...texts) => texts.map((text) => ({ text }));

test('finds a phrase ignoring case, extra spaces and invisible joiners', () => {
  const page = lines('The Feudal  System began', 'सामंतवाद का \u200Dपरिचय', 'nothing here');
  assert.deepEqual(findLines(page, 'feudal system'), [0]);
  assert.deepEqual(findLines(page, 'सामंतवाद का परिचय'), [1]);
  assert.deepEqual(findLines(page, 'missing'), []);
  assert.deepEqual(findLines(page, '   '), []);
});

test('a phrase that wraps onto the next line is reported at the line it starts on, once', () => {
  const page = lines('सामंतवाद के ढाँचे के', 'भीतर समाज ने', 'भीतर समाज');
  assert.deepEqual(findLines(page, 'के भीतर'), [0]);
  assert.deepEqual(findLines(page, 'भीतर समाज'), [1, 2]);
});

test('composed and decomposed Unicode match each other', () => {
  assert.equal(normalizeForSearch('क\u093C'), normalizeForSearch('क\u093C'.normalize('NFD')));
});
