# Architecture

PDF Voice Reader is a small Android shell around a web app. The shell serves the web files, opens the file picker and
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
| App flows | `app/` | Opening a PDF (`open-pdf`), keyboard shortcuts (`keyboard`). | player, viewer, settings, services, ui, core |
| Features | `player/` | Reading aloud: `playback` (state machine), `controls` (buttons, speed), `voices`, `now-bar` (view). | document, viewer/highlight, services, text, ui, core |
| | `viewer/` | The scrolling pages: `page-list`, `renderer`, `layout`, `zoom`, `pager`, `line-layer`, `highlight`, `page-badge`. | document, core |
| | `settings/` | The settings sheet. | player/controls+voices, services, ui, core |
| Document | `document/` | `page-model` (a page record), `page-text` (which lines a page uses: PDF text or Gemini). **No DOM.** | services, text, ui/banner+notice, core |
| Services | `services/` | Talking to the outside world: pdf.js, Gemini (text, OCR, voices), device speech. | text, core |
| Text logic | `text/` | **Pure functions** (no DOM, no state, unit-tested): `devanagari` (matra repair, garbled-text detection), `line-grouping`, `sentences`, `ocr-parse`. | – |
| UI leaves | `ui/` | Small shared views: `notice`, `banner`, `theme`, `header`. | core |
| Core | `core/` | `config` (constants), `state` (the one shared state object), `store` (preferences), `ocr-cache` (IndexedDB), `bus` (events), `dom` (element lookup), `util`. | – |

### How modules talk without importing each other

Lower layers must not know about higher ones, so they announce things on `core/bus.js` instead:

| Event | Sent by | Heard by |
|---|---|---|
| `line:tap` | `viewer/line-layer` (user tapped a line) | `player/playback` |
| `page:lines-changed` | `document/page-text` (OCR arrived, settings changed) | `viewer/renderer` (re-lays out the tappable boxes) |
| `page:status` | `document/page-text` ("Gemini is reading this page…") | `viewer/page-list` (page badge) |
| `settings:saved` | `settings/settings-panel` | `document/page-text` (re-decide which pages need Gemini) |
| `theme:dark` | `ui/theme` | `viewer/renderer` (redraw pages inverted) |
| `voice:changed` | `player/voices` | `player/playback` (restart the sentence) |
| `player:pause` | `services/device-tts` (Android notification) | `player/playback` |

### State

`core/state.js` is the single shared mutable object (document, pages, zoom, playback). Each field has a named owner
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
| Pure text logic (`text/`) | `npm test` (Node's built-in test runner, `web-tests/unit/`) | Node 22 |
| The whole web app | `node web-tests/e2e/run.mjs <pdf> all` (boot, open, render, tap, pause/stop, zoom + pinch, pinned header, dark pages, settings, console errors) | Chrome, or a USB-debugging phone; see the header of the file |
| Android build | GitHub Actions (`.github/workflows/main.yml`) | – |

## Adding things

* **A new setting**: constant/key in `core/config.js`, field in `core/store.js`, control in `index.html`, element id in
  `core/dom.js`, read/write in `settings/settings-panel.js`.
* **A new reader behaviour** (say, "read headings louder"): sentence rules → `text/sentences.js` + a unit test;
  playback → `player/playback.js`.
* **A new PDF quirk** (another broken font): `text/devanagari.js` + a unit test with chunk data copied from the PDF.
* **A new native capability**: a method in `AndroidTtsBridge.kt` (or a new small bridge class), and a wrapper in
  `services/` so the rest of the app never touches `window.AndroidTTS` directly.
