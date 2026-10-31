// What is shown on the page is not always what should be said: abbreviations are spoken in full. Pure: unit-testable.
//
// A speech engine reads "उदा" as a few letters and "Ex." as "ex dot"; a reader would say "उदाहरण" and "example". The text on
// screen (and in the player bar) is left as it is; only what goes to the speech engine passes through here.

// An abbreviation is only recognised as a whole word (not inside "उदाहरण" or "index"), and the English ones only with a
// full stop or a colon behind them ("ex-president" stays as it is).
const RULES = [
  [/(?<![\w\u0900-\u097F])उदा(?:\s*\.(?!\.)|(?![\w\u0900-\u097F]))/g, 'उदाहरण'],
  [/(?<![\w\u0900-\u097F])e\.?\s?g\.(?![\w\u0900-\u097F])/gi, 'for example'],
  [/(?<![\w\u0900-\u097F])i\.\s?e\.(?![\w\u0900-\u097F])/gi, 'that is'],
  [/(?<![\w\u0900-\u097F])ex(?:\.|(?=\s*:))(?![\w\u0900-\u097F])/gi, 'example'],
  [/(?<![\w\u0900-\u097F])viz\.(?![\w\u0900-\u097F])/gi, 'namely'],
  [/(?<![\w\u0900-\u097F])vs\.(?![\w\u0900-\u097F])/gi, 'versus'],
  [/(?<![\w\u0900-\u097F])approx\.(?![\w\u0900-\u097F])/gi, 'approximately'],
  [/(?<![\w\u0900-\u097F])etc\./gi, 'et cetera']
];

export function forSpeech(text) {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
