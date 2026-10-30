# Glyph table

Some PDFs carry a wrong glyph -> Unicode map in their fonts, so the text they give out is wrong although the page looks
right (the glyph drawn as ज is reported as ि). `build.py` makes `app/src/main/assets/js/text/glyph-table-data.js`: for each
known font, what each glyph really is. The app uses it at run time (see ARCHITECTURE.md, "Reading broken Hindi PDFs").

```
pip install pymupdf fonttools uharfbuzz
python tools/glyph-table/build.py --pdf some.pdf ^
   --ref "Baloo2-SemiBold=Baloo2[wght].ttf@600" --ref "Baloo2-Bold=Baloo2[wght].ttf@700"
```

* `--pdf` is any PDF that embeds the fonts (the table keys are glyph ids, which are the same in every PDF made with the
  same build of a font; the advance width stored next to each entry guards against another build).
* `--ref` points at the real font file for an embedded font. Its glyphs are matched to the PDF's by outline (only exact
  matches count) and the text of each is found by shaping Devanagari syllables with HarfBuzz. The Baloo 2 and Poppins
  files are SIL-OFL fonts from <https://github.com/google/fonts/tree/main/ofl>.
* `labels/ms-devanagari.json`: Kokila, Kokila-Bold/Italic, Utsaah and Utsaah-Bold share one glyph layout. No reference
  font is available (they are Microsoft fonts), so each glyph was identified by looking at its shape.
* `labels/fixes.json`: further hand-read corrections for fonts without a reference file (Poppins-SemiBold titles).
* Placeholders in the texts: U+E010 = a ि drawn before its consonant, U+E011 = a reph (र्) drawn after its syllable,
  U+E015 = a ि and a reph in one glyph. `js/text/lost-glyphs.js` puts them in the right place.

To support another publisher's PDF, run the script on it and check the rare glyphs against the page (a glyph that is wrong
shows as a wrong word); add reference files or labels as needed. Do not commit font files you are not licensed to ship:
only the generated table (glyph ids and texts) goes into the app.
