// Character classes shared by the Devanagari text modules. Pure constants, no logic.

export const NUL = '\x00';
export const VIRAMA = '्';
export const RA = 'र';
export const I_MATRA = 'ि';       // ि
export const II_MATRA = 'ी';      // ी
export const O_MATRA = 'ो';       // ो
export const ON_MATRA = 'ों'; // ों (ो + anusvara)

// Regex source pieces (strings, to be combined with new RegExp).
export const CONS = '[\\u0915-\\u0939\\u0958-\\u095F]\\u093C?';                 // a consonant, optional nukta
export const CLUSTER = '(?:' + CONS + '(?:\\u094D' + CONS + ')*)';             // consonant + (virama consonant)*
export const SIGNS = '[\\u093E-\\u094C\\u0962\\u0963\\u0901-\\u0903]';          // dependent vowel signs, anusvara, visarga
