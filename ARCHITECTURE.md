# Architecture

PDF Voice Reader (it also opens Word .docx files) is a small Android shell around a web app. The shell serves the web files, opens the file picker and
exposes Android's text-to-speech; **everything the user sees and does is the web app**, which also runs in a desktop
browser.

```
┌──────────────────────────── Android (Kotlin) ────────────────────────────┐
│ MainActivity ── AssetServer      serves assets/ over https (a real origin) │
│      │      ├── PdfFileChooser   system file picker                        │
│      │      ├── SpeechEngine ◄── AndroidTtsBridge  (window.AndroidTTS)     │
│      │      └── KeepAlive ─────► SpeechService     foreground notification │
└──────┼────────────────────────────────────────────────────────────────────┘
       ▼ WebView
┌────────────────────────── Web app (assets/, ES modules) ─────────────────┐
│ index.html (markup)  css/ (6 files)  js/main.js (composition root)        │
└───────────────────────────────────────────────────────────────────────────┘
```

## Web app layers

Dependencies point **downwards only**; there are no import cycles (enforced by a test, see "Design rules"). Each layer is a
folder under `app/src/main/assets/js/`.

| Layer | Folder | Responsibility | May import |
|---|---|---|---|
| Entry | `main.js` | Calls every feature's `init…()` in order. The only file that knows all features. | everything |
| App flows | `app/` | Opening a file (`open-file`: PDF or Word), keyboard shortcuts (`keyboard`). | player, viewer, settings, services, ui, core |
| Features | `player/` | Reading aloud: `playback` (state machine), `controls` (buttons, speed), `voices`, `now-bar` (view). | document, viewer/highlight, services, text, ui, core |
| | `viewer/` | The scrolling pages: `page-list`, `renderer`, `layout`, `zoom`, `pager`, `line-layer`, `highlight`, `page-badge` (PDF) and `docx-view` (Word). | document, text, core |
| | `settings/` | The settings sheet. | player/controls+voices, services, ui, core |
| | `search/` | Search bar: finds a phrase on every page (reads each page's text in the background), jumps between hits, marks the hit (`viewer/found-mark`) and lets ▶ read from it. | document, viewer, text, core |
| Document | `document/` | `page-model` (a page record), `page-text` (which lines a page uses: PDF text or Gemini). **No DOM.** | services, text, ui/banner+notice, core |
| Services | `services/` | Talking to the outside world: pdf.js, mammoth (Word), Gemini (text, OCR, voices), device speech, `page-glyphs` (the glyphs a page draws, with what the glyph table says they are), `glyph-kinds` (what each lost glyph on a page really is). | text, core |
| Text logic | `text/` | **Pure functions** (no DOM, no state, unit-tested): `devanagari` (repair rules, garbled-text detection, spacing), `lost-glyphs` (putting back र् / ि / ी / ो once their kind is known), `glyph-table` + generated `glyph-table-data` (what the glyphs of known fonts really are), `devanagari-chars`, `line-grouping`, `layout-order` (reading order: columns, figures, paragraphs), `sentences` (PDF lines -> sentences), `sentence-split` (Word text -> sentences), `speech-text` (what is said differs from what is shown: उदा -> उदाहरण, Ex. -> example), `ocr-parse`. | – |
| UI leaves | `ui/` | Small shared views: `notice`, `banner`, `theme`, `header`, `haptics` (a short tick on button presses). | core |
| Core | `core/` | `config` (constants), `state` (the one shared state object), `store` (preferences), `ocr-cache` (IndexedDB), `bus` (events), `dom` (element lookup), `util`. | – |

### How modules talk without importing each other

Lower layers must not know about higher ones, so they announce things on `core/bus.js` instead:

| Event | Sent by | Heard by |
|---|---|---|
| `line:tap` | `viewer/line-layer` (user tapped a line) | `player/playback` |
| `document:opened` | `app/open-file` | `search/search-bar` (forget hits of the previous file) |
| `page:lines-changed` | `document/page-text` (OCR arrived, settings changed) | `viewer/renderer` (re-lays out the tappable boxes) |
| `page:status` | `document/page-text` ("Gemini is reading this page…") | `viewer/page-list` (page badge) |
| `settings:saved` | `settings/settings-panel` | `document/page-text` (re-decide which pages need Gemini) |
| `theme:dark` | `ui/theme` | `viewer/renderer` (redraw pages inverted) |
| `voice:changed` | `player/voices` | `player/playback` (restart the sentence) |
| `player:pause` | `services/device-tts` (Android notification) | `player/playback` |

### Reading order of a PDF page
`text/layout-order.js` is a recursive "XY cut": split the page at the widest empty vertical corridor that runs through the
whole region (a column gutter), left part first; if there is none, at the widest empty horizontal band, upper part first;
repeat. A region needs four lines before it can be split into columns, so a single line is never cut; a wide chunk that
spans a gutter (a title) is cut around first, a small caption squeezed between columns is tolerated, and in long regions a
couple of chunks whose pdf.js width is too long may poke into the gutter. Limits: a table is read column by column, and a
figure with fewer than four lines per box is read across.

### Look and touch
`css/theme.css` holds the tokens (light / dark colours, radii, shadows) and the one button system: every control is at
least 44 px (40 px on very narrow phones), has a pressed state (a scale + a tint of its own colour), no tap flash and
`touch-action: manipulation` (no double-tap delay). Icons are one inline SVG sprite at the top of `index.html`
(`<use href="#i-play">`), drawn with the same stroke everywhere; none is an emoji or a text glyph. The top bar, the player
card, the search bar and the zoom control are translucent ("glass") cards over the page.

### Continuous reading without gaps
Each sentence is one speech request. Starting it only when the previous one has ended costs the engine's start-up
(about half a second) every time, which makes short lines sound slow. So while sentence N plays, `player/playback`
already queues N+1 in the device engine (`queueAhead`); when N ends only the highlight and the player bar move on
(`sentenceEnded`). Pause / stop / tap / speed change flush the engine queue and forget what was queued. Gemini voices
prefetch their audio instead, and the next page (which may need text extraction or Gemini) is still started on demand.

### State

`core/state.js` is the single shared mutable object (document, pages, zoom, playback). `state.doc` is the open document and `state.docKind` says what it is (`'pdf'` or `'docx'`); a page record carries the same `kind`, and everything that is PDF-specific (canvases, viewports, Gemini) checks it. Each field has a named owner
in the file; other modules read it but change only what they own. Preferences that must survive a restart go through
`core/store.js` (`localStorage`); the Gemini read-page cache is in IndexedDB (`core/ocr-cache.js`).

## Data flow of the main use case

```
open PDF ─► app/open-pdf ─► services/pdf-engine ─► viewer/page-list (placeholders for every page)
                                                        │ page near the screen
                                   viewer/renderer ◄────┘ draws canvas, then asks:
                                   document/page-text.ensureText(page)
                                        pdf.js text ─► text/line-grouping ─► text/devanagari (repair)
                                        (garbled / lossy? and a key is set) ─► services/gemini-ocr ─► ocr-cache
                                        lines ─► text/sentences
                                   viewer/line-layer  (tappable boxes)
tap a line ─► bus line:tap ─► player/playback.speakSentence ─► services/speech ─► Gemini voice | device voice (Android bridge)
```

## Reading broken Hindi PDFs (why the text code looks the way it does)

Many PDFs (browser / Google Docs exports) draw Devanagari with ligature glyphs that have no entry in the font's
text map. Every reader then gets wrong text from them, not just this app: a lost ि, a lost र्, or one glyph standing
for र्+ी / र्+ो. pdf.js reports a NUL character for each. The app recovers the letters in three tiers, best first:

1. **Glyph kinds** (`services/glyph-kinds.js` + `text/lost-glyphs.js`, exact for the PDFs tested). The page's drawing
   instructions list the same glyphs in the same order as the NULs, with facts the text lacks: the advance width
   (0 = lone र्, same as a real ि = ि, same as a real ा = र् fused with a vowel sign) and, for the fused ones, the ink
   of the glyph drawn with the PDF's own font (a ी has a hook left of its origin, a ो does not). Word position then
   decides ो (सर्वोच्च) against ों (वर्षों). If the NULs and glyphs do not line up, tier 2 is used for that chunk.
2. **Position rules** (`text/devanagari.js` `repairItem`): a NUL at the start of a text chunk is a ि, at the end a र्.
   Right for many words, wrong when one glyph stands for two letters (प्रतिस्पर्धी came out as प्रतिस्पर्ध).
3. **Gemini** (`services/gemini-ocr.js`): reads the page picture; exact, but needs an API key and internet.

**Tier 0: the glyph table** (`text/glyph-table.js`, `services/page-glyphs.js`, data generated by `tools/glyph-table/`).
Some PDFs are worse than "lost" glyphs: the font's text map is WRONG, so the page looks right but pdf.js says the glyph
drawn as ज is a ि and the heading reads "व्य वस्ा". The glyphs are fine, only the map is not, so the app keeps a table of
what each glyph of a known font really is, keyed by font name + glyph id (+ advance width as a guard against another build
of the font). Every glyph the page draws comes from its drawing instructions; `correctItems` rebuilds the text items
from them, then the usual line building runs. ि glyphs and reph glyphs are put in as placeholders (U+E010, U+E011, U+E015)
so `text/lost-glyphs.js` moves them to where they belong in the word. If the items cannot be matched up with the glyphs,
the page is left exactly as pdf.js made it. The same glyph list fixes a pdf.js quirk: it sometimes ends a line's item with the
first glyph(s) of the next line ("...आलोचनात्मक दृ" / "ष्टि से..."); glyphs that come from the drawing instruction the next
item continues, on another line, are moved over (`moveStrayGlyphs`). Where a PDF's words are separated by real space glyphs, spaces pdf.js
invents between far-apart glyphs are dropped and a gap between chunks adds none (a very wide gap still does: table columns).
How the table is made (`tools/glyph-table/README.md`): fonts that are open-licence files (Baloo 2) are matched glyph by
glyph by outline and read off the real font with HarfBuzz (exact); the Microsoft Devanagari fonts (Kokila, Utsaah) share
one glyph layout and were identified by looking at the glyph shapes. It only helps PDFs made with those fonts.

Alternatives that were tried or considered:
* *Text-shaping libraries* (HarfBuzz, ICU) hold the Devanagari rules but only go text -> glyphs; the PDF needs glyphs -> text.
* *On-device OCR* (Tesseract.js with the 1.1 MB Hindi model) read the test page correctly in ~4 s on a laptop, but on the
  3.5 GB test phone it pushed memory so hard that Android killed the app and others. Not shipped.
* *Python libraries* (fontTools, PyMuPDF, pdfminer) find a glyph's character through the cmap, the glyph name or the PDF's
  ToUnicode table: for these PDFs the glyph names are stripped and the ToUnicode table is the part that is wrong.
* *Matching a glyph's shape against known vowel signs* was unreliable (ी, ा and ो overlap too much); the ink-left test
  above is the one feature that separated them.

## Word (.docx) files

A Word file is not a stack of drawn pages, so it has its own viewer, but it reuses the whole player (sentences, voices,
speed, continue-reading, pause / stop, the now-playing bar), the pager, zoom, dark mode and saved position.

```
open-file -> services/docx-engine (mammoth.js: .docx -> HTML) -> viewer/docx-view.buildDocxPages
   HTML is cut into "parts" (~30 blocks each) that act as pages; every sentence of every paragraph / heading / list item /
   table cell (text/sentence-split) gets a DOM Range. page record: kind 'docx', lines = sentences, segs 1:1.
tap -> caret position -> the sentence whose Range contains it -> bus line:tap -> player/playback (unchanged)
reading -> viewer/highlight -> CSS Custom Highlight API (::highlight(reading)) on that Range
zoom = font size (--docx-zoom), dark mode = the app theme variables; no canvas, no OCR, no glyph repair
```

Word text is real Unicode, so the PDF text repair and Gemini never run for it. Limits: old `.doc` files are not supported
(save as `.docx`); text in an old non-Unicode Hindi font (Kruti Dev, Chanakya) is detected by the same garbled-text check and
refused with a message instead of being mispronounced; images are shown but not described; headers, footers and footnotes
are not part of mammoth's output.

## Design rules this code follows

1. **One job per module**, named after that job. Pure logic is separated from DOM and from I/O so it can be tested.
2. **No work at import time.** Every feature exposes `init…()`; `main.js` is the start-up sequence.
3. **Dependencies point down, never up or sideways** (events cover the "up" cases). `web-tests/unit/architecture.test.mjs`
   enforces the table above: allowed imports per layer, no cycles, no DOM in `text/` and `document/`, no work at import time.
4. **One owner per piece of state**; one place for each constant (`config.js`) and each element id (`dom.js`).
5. **Stale async results must not act.** Anything that awaits (OCR, page loads, sentences) re-checks a token or a
   generation counter afterwards (`player/playback` token, `viewer/renderer` `gen`).
6. **The Kotlin shell stays thin.** It adds only what a WebView cannot do; behaviour lives in the web app.

## Android shell (`app/src/main/java/com/example/pdfvoicereader/`)

| File | Responsibility |
|---|---|
| `MainActivity.kt` | WebView setup and wiring of the pieces below; nothing else. |
| `AssetServer.kt` | Answers `https://appassets.androidapp.com/assets/…` from the APK's assets (with the right MIME types for ES modules). |
| `PdfFileChooser.kt` | The system file picker for `<input type="file">`. |
| `SpeechEngine.kt` | Wraps `TextToSpeech`: voices, queued / flushed speech, lead-in silence. Reports back through a listener. |
| `AndroidTtsBridge.kt` | `window.AndroidTTS`: the thin `@JavascriptInterface` the page calls. |
| `KeepAlive.kt` + `SpeechService.kt` | Foreground service (notification with Pause, wake lock) that keeps the process alive while reading and while the file picker is open. |
| `PlaybackControl.kt` | Lets the notification's Pause button reach the page. |

## Tests

| What | How | Needs |
|---|---|---|
| Pure text logic (`text/`) and the architecture rules | `npm test` (Node's built-in test runner, `web-tests/unit/`) | Node 22 |
| The whole web app | `node web-tests/e2e/run.mjs <pdf> all` (boot, open, render, text quality, tap, pause/stop, zoom + pinch, pinned header, dark pages, settings, search, the Word file `web-tests/fixtures/sample.docx`, console errors) | Chrome, or a USB-debugging phone; see the header of the file |
| Android build | GitHub Actions (`.github/workflows/main.yml`) | – |

## Adding things

* **A new setting**: constant/key in `core/config.js`, field in `core/store.js`, control in `index.html`, element id in
  `core/dom.js`, read/write in `settings/settings-panel.js`.
* **A new reader behaviour** (say, "read headings louder"): sentence rules → `text/sentences.js` + a unit test;
  playback → `player/playback.js`.
* **A new PDF quirk** (another broken font): `text/devanagari.js` + a unit test with chunk data copied from the PDF.
* **A new native capability**: a method in `AndroidTtsBridge.kt` (or a new small bridge class), and a wrapper in
  `services/` so the rest of the app never touches `window.AndroidTTS` directly.
