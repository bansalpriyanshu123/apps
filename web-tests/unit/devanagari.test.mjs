import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLostGlyphs, looksGarbled, looksLikeLegacyHindi, needsSpaceBetween, repairItem, tidyLineText
} from '../../app/src/main/assets/js/text/devanagari.js';

const NUL = String.fromCharCode(0);
const repair = (chunks, visualOrder = true) => chunks.map((chunk) => repairItem(chunk, visualOrder)).join('');

// Chunk streams copied from a real PDF whose font has no text map for the i-matra / reph (as pdf.js returned them).
test('lost i-matra (NUL at the start of a chunk) is restored after the consonant cluster', () => {
  assert.equal(repair(['सं', NUL + 'व', 'धान']), 'संविधान');
  assert.equal(repair(['प', NUL + 'र', 'चय']), 'परिचय');
  assert.equal(repair(['स', NUL + 'क्र', 'यता']), 'सक्रियता');          // cluster क्र gets the ि
  assert.equal(repair(['अ', NUL + 'त', 'स', NUL + 'क्र', 'यता']), 'अतिसक्रियता');
  assert.equal(repair(['मं', NUL + 'त्र', 'मंडल']), 'मंत्रिमंडल');
  assert.equal(repair(['न्', 'या', NUL + 'य', 'क']), 'न्यायिक');
});

test('lost reph (NUL at the end of a chunk) is restored before the last consonant cluster', () => {
  assert.equal(repair(['का', 'य' + NUL, 'पा', NUL + 'ल', 'का']), 'कार्यपालिका');
  assert.equal(repair(['का', 'या' + NUL, 'लय']), 'कार्यालय');
  assert.equal(repair(['का', 'य' + NUL, 'वाही']), 'कार्यवाही');
});

test('a real i-matra at the start of a chunk is in screen order and moves after its cluster', () => {
  assert.equal(repair(['श', 'िक्त']), 'शक्ति');
  assert.equal(repair(['की', NUL + 'न', 'यु', 'िक्त']), 'कीनियुक्ति');
});

test('the screen-order fix only applies when the PDF is known to need it', () => {
  assert.equal(repairItem('िता', false), 'िता');
  assert.equal(repairItem('विधान', true), 'विधान');
  assert.equal(repairItem('कि', true), 'कि');
});

test('placeholders are detected and never survive repair', () => {
  assert.equal(hasLostGlyphs([{ str: 'abc' }, { str: NUL + 'व' }]), true);
  assert.equal(hasLostGlyphs([{ str: 'सामान्य' }]), false);
  assert.ok(!/[\x00\uFFFD]/.test(repairItem('a' + NUL + 'b\uFFFD' + NUL, true)));
});

test('no space is inserted inside a word, only between words', () => {
  assert.equal(needsSpaceBetween('राजव्', 'यवस्', 2, 10), false);       // small gap after a virama: one conjunct
  assert.equal(needsSpaceBetween('अर्थात्', 'आगे', 5, 10), true);       // a word may END in a virama
  assert.equal(needsSpaceBetween('नोट', '्स', 5, 10), false);          // chunk starts with a sign
  assert.equal(needsSpaceBetween('भारत', 'देश', 5, 10), true);
  assert.equal(needsSpaceBetween('भारत', 'देश', 0.5, 10), false);      // touching
  assert.equal(tidyLineText('भारतीय  राजव् यवस् था  '), 'भारतीय राजव्यवस्था');
  assert.equal(tidyLineText('केन्द्र शासित प्रदे श (केन्द्र) अध्यादे श।'), 'केन्द्र शासित प्रदेश (केन्द्र) अध्यादेश।');
  assert.equal(tidyLineText('वित्त आयोग के लिए'), 'वित्त आयोग के लिए');   // real short words are untouched
  // words that really end in a halant keep the space after them
  assert.equal(tidyLineText('(अर्थात् राष्ट्रपति ) मंत्रिपरिषद् के परामर्श संसद् की'), '(अर्थात् राष्ट्रपति ) मंत्रिपरिषद् के परामर्श संसद् की');
  assert.equal(tidyLineText('नोट् स'), 'नोट्स');
  assert.equal(needsSpaceBetween('अर्थात्', 'राष्ट्रपति', 2, 10), true);
});

test('legacy-font text (Kruti Dev style) is recognised as garbled, real Hindi and English are not', () => {
  const kruti = 'fganh Hkk"kk ds izfr vkn\'kZ] vkSj ,d lkFk ;g gS A bl ys[k esa gesa tkuuk gS fd D;k [kkuk pkfg;s';
  assert.equal(looksLikeLegacyHindi(kruti), true);
  assert.equal(looksGarbled([{ text: kruti }]), true);
  assert.equal(looksGarbled([{ text: 'भारत एक विशाल देश है जिसमें कई भाषाएँ बोली जाती हैं और संस्कृति प्राचीन है।' }]), false);
  assert.equal(looksGarbled([{ text: 'Section 4.2 describes the results of the experiment, which were recorded by the team.' }]), false);
  assert.equal(looksGarbled([{ text: '%%% 000 %%% 000 %%% 000 %%% 000 %%% 000' }]), true);
  assert.equal(looksGarbled([{ text: 'short' }]), false);              // too little text to judge
});

test('a Wingdings bullet that came out as a control character becomes a bullet at the start of a line and vanishes elsewhere', async () => {
  const { tidyLineText } = await import('../../app/src/main/assets/js/text/devanagari.js');
  assert.equal(tidyLineText('\u0089लेनिन के गिरते'), '\u2022 लेनिन के गिरते');
  assert.equal(tidyLineText('\uF034\u0007वर्सेल्स संधि'), '\u2022 वर्सेल्स संधि');
  assert.equal(tidyLineText('श्\u001Aांृखला'), 'श्ांृखला');
});
