#!/usr/bin/env python3
"""Builds app/src/main/assets/js/text/glyph-table-data.js.

Why: some PDFs have a wrong (or missing) glyph -> Unicode map in their fonts, so the text pdf.js extracts is wrong
("व्य वस्ा" for "व्यवस्था") although the page LOOKS right. The glyphs themselves are correct, so we keep a table that says
what each glyph of a known font really is. The app looks glyphs up by (font name, glyph id) and checks the advance width
so another build of the same font is never trusted by mistake.

Two sources:
  * Microsoft Devanagari layout (Kokila, Kokila-Bold/Italic, Utsaah, Utsaah-Bold): one hand-checked label file,
    labels/ms-devanagari.json, identified by looking at the glyph shapes (no reference font is available).
  * Fonts without a reference file: hand-read corrections in labels/fixes.json (only the wrong glyphs).
  * Fonts available as real files (Baloo 2, Poppins; open licence): exact. Every glyph of the PDF's embedded subset is
    matched to the glyph of the real font by its outline, and the text of the real font's glyph is found by shaping a corpus of
    Devanagari syllables with HarfBuzz and reading which glyphs come out.

Usage:
  python tools/glyph-table/build.py --pdf sample.pdf \
      --ref "Baloo2-SemiBold=Baloo2[wght].ttf@600" --ref "Baloo2-Bold=Baloo2[wght].ttf@700" \
      --ref "Poppins-SemiBold=Poppins-SemiBold.ttf"
  The reference fonts are open-licence Google fonts: https://github.com/google/fonts/tree/main/ofl/baloo2 and /poppins
Needs: pymupdf, fonttools, uharfbuzz.

Placeholders used in texts (see js/text/lost-glyphs.js): U+E010 i-matra drawn before its consonant, U+E011 a reph
drawn after its syllable, U+E015 an i-matra + reph glyph drawn before the consonant.
"""
import argparse
import collections
import io
import json
import os
import re
import sys

import pymupdf
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'app', 'src', 'main', 'assets', 'js', 'text', 'glyph-table-data.js')
MARK_I, MARK_REPH, MARK_I_REPH = '', '', ''
MS_FONTS = ('Kokila', 'Kokila-Bold', 'Kokila-Italic', 'Kokila-BoldItalic', 'Utsaah', 'Utsaah-Bold')


def embedded_fonts(doc):
    """{base font name: TTFont} of the PDF's embedded CID TrueType fonts (glyph id == character code)."""
    fonts = {}
    for page_no in range(len(doc)):
        for xref, ext, kind, name, _ref, _enc in (f[:6] for f in doc.get_page_fonts(page_no, full=True)):
            base = name.split('+')[-1]
            if kind != 'Type0' or ext != 'ttf' or base in fonts:
                continue
            data = doc.extract_font(xref)[3]
            if not data:
                continue
            try:
                font = TTFont(io.BytesIO(data))
            except Exception:
                continue
            if 'glyf' in font:
                fonts[base] = font
    return fonts


def width_1000(font, gid):
    upem = font['head'].unitsPerEm
    return round(font['hmtx'][font.getGlyphName(gid)][0] * 1000 / upem)


# --- Microsoft Devanagari layout ------------------------------------------------------------------------------------

def build_ms(fonts):
    labels = json.load(open(os.path.join(HERE, 'labels', 'ms-devanagari.json'), encoding='utf-8'))['glyphs']
    table = {}
    for name in MS_FONTS:
        font = fonts.get(name)
        if not font:
            print('  (font not in this PDF, skipped):', name)
            continue
        count = len(font.getGlyphOrder())
        table[name] = {int(g): [text, width_1000(font, int(g))] for g, text in labels.items() if int(g) < count}
    return table


# --- Baloo 2 ----------------------------------------------------------------------------------------------------------

def outline(font, gid):
    name = font.getGlyphName(gid)
    glyph = font['glyf'][name]
    if glyph.numberOfContours == 0:                       # (composite glyphs are flattened by getCoordinates)
        return None
    coords, ends, _flags = glyph.getCoordinates(font['glyf'])
    return {'pts': [tuple(p) for p in coords], 'ends': tuple(ends), 'adv': font['hmtx'][name][0]}


def match_to_reference(subset, reference):
    """subset glyph id -> reference glyph id, by outline."""
    ref_info = {gid: outline(reference, gid) for gid in range(len(reference.getGlyphOrder()))}
    by_signature = collections.defaultdict(list)
    for gid, info in ref_info.items():
        if info:
            by_signature[(len(info['pts']), info['ends'], info['adv'])].append(gid)
    match = {}
    for gid in range(len(subset.getGlyphOrder())):
        info = outline(subset, gid)
        if not info:
            continue
        candidates = by_signature.get((len(info['pts']), info['ends'], info['adv']), [])
        if not candidates:
            continue
        distance = lambda g: sum(abs(a - b) + abs(c - d) for (a, c), (b, d) in zip(info['pts'], ref_info[g]['pts']))
        best = min(candidates, key=distance)
        if distance(best) == 0:                          # only exact outlines are trusted
            match[gid] = best
    return match


def glyph_texts(path):
    """reference glyph id -> the text that glyph stands for, by shaping Devanagari syllables with HarfBuzz."""
    font = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
    tt = TTFont(path)

    def shape(text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.direction, buf.script, buf.language = 'ltr', 'Deva', 'hi'
        hb.shape(font, buf, {'kern': True, 'liga': True})
        return [info.codepoint for info in buf.glyph_infos]

    known = {}
    for cp, name in tt.getBestCmap().items():
        known.setdefault(tt.getGlyphID(name), chr(cp))
    for gid in range(len(tt.getGlyphOrder())):           # empty zero-width glyphs (dummy1 ...) carry no text
        name = tt.getGlyphName(gid)
        if tt['glyf'][name].numberOfContours == 0 and tt['hmtx'][name][0] == 0:
            known.setdefault(gid, '')

    consonants = [chr(c) for c in list(range(0x915, 0x93A)) + list(range(0x958, 0x960))]
    matras = [chr(c) for c in [0x93E, 0x93F, 0x940, 0x941, 0x942, 0x943, 0x944, 0x945, 0x946, 0x947, 0x948, 0x949,
                               0x94A, 0x94B, 0x94C, 0x962, 0x963]]
    signs = [chr(c) for c in (0x901, 0x902, 0x903)]
    virama, nukta, ra = '्', '़', 'र'
    corpus = set(chr(c) for c in list(range(0x904, 0x915)) + [0x960, 0x961, 0x950])
    for c in consonants:
        corpus |= {c, c + nukta, c + virama, c + nukta + virama}
        corpus |= {c + m for m in matras} | {c + nukta + m for m in matras} | {c + s for s in signs}
        corpus |= {c + m + s for m in matras for s in signs}
    for c1 in consonants:
        for c2 in consonants:
            base = c1 + virama + c2
            corpus |= {base, base + virama, ra + virama + base}
            corpus |= {base + m for m in matras} | {base + s for s in signs}
            for c3 in consonants:
                corpus.add(base + virama + c3)
    for c in consonants:
        base = ra + virama + c
        corpus |= {base} | {base + m for m in matras} | {base + s for s in signs} | {base + m + s for m in matras for s in signs}
    shaped = [(s, shape(s)) for s in sorted(corpus, key=lambda s: (len(s), s))]

    def mark(residual):
        if residual == 'ि':
            return MARK_I
        if residual.startswith(ra + virama):
            rest = residual[2:]
            return MARK_I_REPH if rest == 'ि' else MARK_REPH + rest
        return residual

    for _sweep in range(3):
        added = 0
        for text, glyphs in shaped:
            if len(glyphs) == 1:
                if glyphs[0] not in known:
                    known[glyphs[0]] = text
                    added += 1
                continue
            unknown = [g for g in glyphs if g not in known]
            if len(unknown) != 1:
                continue
            residual = text
            for g in glyphs:
                if g in known and known[g] in residual:
                    residual = residual.replace(known[g], '', 1)
            if residual:
                known[unknown[0]] = mark(residual)
                added += 1
        if not added:
            break
    for gid in range(len(tt.getGlyphOrder())):          # the plain reph glyphs, by name (a lone "ra + vocalic r" also shapes to one)
        name = tt.getGlyphName(gid)
        for prefix, rest in (('RephChandrabindu', 'ँ'), ('RephBindu', 'ं'), ('Reph', '')):
            if name.startswith(prefix + '.'):
                known[gid] = MARK_REPH + rest
                break
    return {gid: (MARK_I if text == 'ि' else text) for gid, text in known.items()}


def build_reference(fonts, name, path, weight, workdir):
    """Entries for the PDF's embedded subset `name`, read off the real font at `path` (a variable font is first set to
    `weight`)."""
    subset = fonts.get(name)
    if not subset:
        print('  (font not in this PDF, skipped):', name)
        return {}
    if weight:
        path_ = os.path.join(workdir, f'{name}-{weight}.ttf')
        instancer.instantiateVariableFont(TTFont(path), {'wght': weight}).save(path_)
        path = path_
    reference = TTFont(path)
    match = match_to_reference(subset, reference)
    texts = glyph_texts(path)
    entries = {gid: [texts[ref], width_1000(subset, gid)] for gid, ref in match.items() if ref in texts}
    ink = sum(1 for g in range(len(subset.getGlyphOrder())) if outline(subset, g))
    print(f'  {name}: {len(match)}/{ink} ink glyphs matched exactly, {len(entries)} entries')
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf', required=True, help='a PDF that embeds the fonts (Kokila, Utsaah, Baloo 2 ...)')
    parser.add_argument('--ref', action='append', default=[], metavar='FONTNAME=PATH[@WEIGHT]',
                        help="a real font to read the embedded font's glyphs off, e.g. 'Baloo2-SemiBold=Baloo2[wght].ttf@600' "
                             "(@WEIGHT sets a variable font to that weight); can be repeated")
    parser.add_argument('--workdir', default=os.path.join(HERE, '.work'))
    args = parser.parse_args()
    os.makedirs(args.workdir, exist_ok=True)

    fonts = embedded_fonts(pymupdf.open(args.pdf))
    print('embedded CID fonts:', ', '.join(sorted(fonts)))
    table = build_ms(fonts)
    for spec in args.ref:
        name, _, rest = spec.partition('=')
        path, _, weight = rest.partition('@')
        table[name] = build_reference(fonts, name, path, int(weight) if weight else None, args.workdir)
    fixes = os.path.join(HERE, 'labels', 'fixes.json')               # hand-read corrections (see the file)
    if os.path.exists(fixes):
        for name, glyphs in json.load(open(fixes, encoding='utf-8'))['fonts'].items():
            if name in fonts:
                table.setdefault(name, {}).update({int(g): [text, width_1000(fonts[name], int(g))] for g, text in glyphs.items()})

    lines = [
        '// GENERATED by tools/glyph-table/build.py - do not edit by hand.',
        '// What the glyphs of some known fonts really are, for PDFs whose own glyph -> text map is wrong.',
        '// { fontName: { glyphId: [text, advanceWidth] } } - see text/glyph-table.js for how it is used.',
        'export const GLYPH_TABLE = {'
    ]
    for name in sorted(table):
        entries = ',\n'.join('    %d: %s' % (gid, json.dumps(table[name][gid], ensure_ascii=False)) for gid in sorted(table[name]))
        lines.append('  %s: {\n%s\n  },' % (json.dumps(name), entries))
    lines.append('};\n')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines))
    print('wrote', os.path.normpath(OUT), '-', sum(len(v) for v in table.values()), 'entries')


if __name__ == '__main__':
    sys.exit(main())
