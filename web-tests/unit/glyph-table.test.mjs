import test from 'node:test';
import assert from 'node:assert/strict';
import { baseFontName, correctItems, lookupGlyph, usesSpaceGlyphs } from '../../app/src/main/assets/js/text/glyph-table.js';
import { resolveLostGlyphs } from '../../app/src/main/assets/js/text/lost-glyphs.js';
import { GLYPH_TABLE } from '../../app/src/main/assets/js/text/glyph-table-data.js';

const glyph = (unicode, text = null) => ({ unicode, text });

test('lookup needs the font name, the glyph id and a matching advance width', () => {
  const [text, width] = GLYPH_TABLE.Kokila[75];                       // the glyph drawn as ज
  assert.equal(text, 'ज');
  assert.equal(lookupGlyph('RMYNBY+Kokila', 75, width), 'ज');          // subset prefix is ignored
  assert.equal(lookupGlyph('Kokila', 75, width + 2), 'ज');            // rounding tolerance
  assert.equal(lookupGlyph('Kokila', 75, width + 40), null);          // another build of the font: not trusted
  assert.equal(lookupGlyph('Kokila', 99999, width), null);
  assert.equal(lookupGlyph('Arial', 75, width), null);
  assert.equal(baseFontName('PEWTHO+Baloo2-SemiBold'), 'Baloo2-SemiBold');
});

test('correctItems replaces the wrong text of known glyphs, glyph by glyph', () => {
  const glyphs = [glyph('ि', 'ज'), glyph('ा'), glyph(' '), glyph('क')];
  const items = [{ str: 'िा क', width: 1 }];
  assert.deepEqual(correctItems(items, glyphs).map((i) => i.str), ['जा क']);
});

test('a glyph the PDF reports as several letters can be corrected to another number of letters, or to nothing', () => {
  const glyphs = [glyph('थि', ''), glyph('क', 'क्ष'), glyph('\u0001x', 'ab')];
  assert.deepEqual(correctItems([{ str: 'थिक\u0001x' }], glyphs).map((i) => i.str), ['क्षab']);
});

test('spaces pdf.js left out of the items (line ends) or turned from tabs into spaces do not break the matching', () => {
  const glyphs = [glyph('a'), glyph(' '), glyph('b', 'B'), glyph('\t'), glyph('c')];
  const fixed = correctItems([{ str: 'a' }, { str: 'b c' }], glyphs);
  assert.deepEqual(fixed.map((i) => i.str), ['a', ' B c']);
});

test('spaces pdf.js inserted between far apart glyphs are dropped on request, kept otherwise', () => {
  const glyphs = [glyph('a'), glyph('b')];
  const items = [{ str: 'a b' }];
  assert.deepEqual(correctItems(items, glyphs).map((i) => i.str), ['a b']);
  assert.deepEqual(correctItems(items, glyphs, { dropInsertedSpaces: true }).map((i) => i.str), ['ab']);
});

test('items that do not line up with the glyphs give null (the page is then left as pdf.js made it)', () => {
  assert.equal(correctItems([{ str: 'xyz' }], [glyph('a'), glyph('b')]), null);
});

test('untouched items are returned as they are', () => {
  const item = { str: 'ab', width: 3 };
  assert.equal(correctItems([item], [glyph('a'), glyph('b')])[0], item);
});

test('pages whose words come with real space glyphs are recognised', () => {
  const prose = Array.from({ length: 40 }, (_, i) => glyph(i % 6 === 5 ? ' ' : 'a'));
  assert.equal(usesSpaceGlyphs(prose), true);
  assert.equal(usesSpaceGlyphs(Array.from({ length: 40 }, () => glyph('a'))), false);
  assert.equal(usesSpaceGlyphs([glyph(' ')]), false);
});

test('an i-matra + reph glyph (drawn before its consonant) becomes र् + consonant + ि', () => {
  const MARK = '\uE015';
  assert.equal(resolveLostGlyphs('क' + MARK + 'मा'), 'क' + 'र्मि' + 'ा');
});

test('the table maps i-matra glyphs to the placeholder so they end up after their consonant', () => {
  assert.equal(GLYPH_TABLE.Kokila[108][0], '\uE010');
  assert.equal(resolveLostGlyphs('\uE010' + 'व'), 'वि');
});

test('the first glyph of a new line that pdf.js put at the end of the line above goes back to its own line', () => {
  const g = (unicode, run) => ({ unicode, text: null, run });
  // line 1 is drawn by instruction 1; line 2 by instruction 2 and starts with "दृ"; pdf.js ended item 1 with "दृ"
  const glyphs = [g('आ', 1), g('क', 1), g(' ', 1), g('दृ', 2), g('ि', 2), g('ष', 2)];
  const items = [
    { str: 'आक दृ', transform: [10, 0, 0, 10, 0, 100], height: 10 },
    { str: 'िष', transform: [10, 0, 0, 10, 0, 90], height: 10 }
  ];
  assert.deepEqual(correctItems(items, glyphs).map((i) => i.str), ['आक ', 'दृिष']);
});

test('glyphs of one instruction that pdf.js split into two items on the SAME line stay where they are', () => {
  const g = (unicode, run) => ({ unicode, text: null, run });
  const glyphs = [g('अ', 1), g(' ', 1), g('ब', 2), g('स', 2)];
  const items = [
    { str: 'अ ब', transform: [10, 0, 0, 10, 0, 100], height: 10 },
    { str: 'स', transform: [10, 0, 0, 10, 80, 100], height: 10 }
  ];
  assert.deepEqual(correctItems(items, glyphs).map((i) => i.str), ['अ ब', 'स']);
});
