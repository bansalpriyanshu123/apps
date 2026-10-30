// Reads the glyphs a page draws, in drawing order, from its drawing instructions. For each one: what pdf.js says it is
// (`unicode`) and, when its font is in the table of known fonts, what it really is (`text`, see text/glyph-table.js).
// The glyph objects themselves are kept for services/glyph-kinds.js.

import { lookupGlyph } from '../text/glyph-table.js';
import { pdfOps } from './pdf-engine.js';

const cache = new WeakMap();

const FONT_WAIT_MS = 4000;

/** The font of a drawing instruction, waiting for pdf.js to finish loading it if it has not yet. */
async function describeFont(page, fontId) {
  const font = await Promise.race([
    new Promise((resolve) => page.commonObjs.get(fontId, resolve)),
    new Promise((resolve) => setTimeout(() => resolve(null), FONT_WAIT_MS))
  ]);
  return font ? { name: font.name, composite: !!font.composite } : { name: '', composite: false };   // composite: Type0, glyph id == character code
}

/** @returns [{ unicode, text, fontId, glyph }] for every glyph of the page (cached per page) */
export function readPageGlyphs(page) {
  if (!cache.has(page)) cache.set(page, collect(page));
  return cache.get(page);
}

async function collect(page) {
  const OPS = pdfOps();
  const ops = await page.getOperatorList();
  const fonts = new Map();
  for (let i = 0; i < ops.fnArray.length; i++) {
    const id = ops.argsArray[i] && ops.argsArray[i][0];
    if (ops.fnArray[i] === OPS.setFont && !fonts.has(id)) fonts.set(id, await describeFont(page, id));
  }
  const glyphs = [];
  let fontId = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.setFont) { fontId = ops.argsArray[i][0]; continue; }
    if (fn !== OPS.showText && fn !== OPS.showSpacedText) continue;
    const font = fonts.get(fontId) || { name: '', composite: false };
    for (const glyph of ops.argsArray[i][0] || []) {
      if (!glyph || typeof glyph !== 'object') continue;           // numbers are kerning adjustments
      const text = font.composite ? lookupGlyph(font.name, glyph.originalCharCode, glyph.width) : null;
      glyphs.push({ unicode: glyph.unicode || '', text, fontId, glyph });
    }
  }
  return glyphs;
}
