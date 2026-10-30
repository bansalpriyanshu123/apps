# PDF Voice Reader — Android

Open a Hindi PDF, scroll through it, tap any line and hear it read aloud at the speed you choose.
The app is a small Android shell around a single web page (`app/src/main/assets/index.html`).
Speech comes from Android's own text‑to‑speech engine (Google TTS), so it works offline once a Hindi voice is installed.

## Build the APK

### Option A — in the cloud, nothing to install (recommended)

1. Create a free GitHub account if you don't have one, and make a new **empty** repository.
2. Upload every file and folder from this project into it (drag the whole folder onto the repo page, or use git).
3. Open the repo's **Actions** tab. The *Build APK* workflow starts automatically on the first push
   (or press *Run workflow*). It takes 3–5 minutes.
4. When it turns green, open the run and download **pdf-voice-reader-apk** from the *Artifacts* section.
   Unzip it to get `app-debug.apk`.
5. Copy the APK to your phone and open it. Allow *Install unknown apps* when asked.

### Option B — Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (it brings its own JDK and SDK).
2. Run `./fetch-pdfjs.sh` (Mac/Linux) or `fetch-pdfjs.bat` (Windows) once, so the PDF engine is bundled.
   Skip this if you're happy for the app to need internet on first load.
3. **File → Open** this folder. If Android Studio asks about the Gradle wrapper, let it create one
   (Gradle 8.7, JDK 17).
4. **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The file appears at
   `app/build/outputs/apk/debug/app-debug.apk`.
5. Or plug in your phone with USB debugging on and press **Run ▶**.

## Garbled Hindi text (“%%% 000”) — Gemini setup

Many Hindi PDFs were made with old non‑Unicode fonts (Kruti Dev, Chanakya, DevLys…). Their text layer is
gibberish, so no reader can speak it. The app detects this and offers to let Gemini read the page image instead.

1. Get a free key at https://aistudio.google.com/apikey
2. In the app, tap ⚙ → paste the key → **Save** (use **Test key** to check it).
3. Pages whose text looks garbled, or scanned pages, are now read by Gemini (`gemini-3.8-flash`) and remembered on
   the device so each page costs money only once. Gemini voices (Kore, Puck…) also appear in the Voice list.

The key lives only in the app's storage on the phone and is sent only to Google.

## Hindi voice on the phone

Settings → System → Languages & input → Text‑to‑speech output → Google Text‑to‑speech → ⚙ → Install voice data → **Hindi**.
Downloaded voices work offline; the app lists them under *Hindi · हिन्दी* and lets you preview each with ▶.

## How it's put together

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map and design rules. In short:

| Path | What it is |
|---|---|
| `app/src/main/assets/index.html` | The page's markup only. |
| `app/src/main/assets/css/` | Styles, split by area (theme, header, viewer, player, settings, responsive). |
| `app/src/main/assets/js/` | The web app as small ES modules in layers: `core`, `text` (pure logic), `services`, `document`, `viewer`, `player`, `settings`, `app`; `main.js` wires them up. |
| `app/src/main/assets/pdfjs/`, `.../mammoth/` | pdf.js (PDF) and mammoth.js (Word), downloaded by `fetch-pdfjs.sh` / `.bat` and by CI so the app works offline. |
| `app/src/main/java/.../MainActivity.kt` and friends | The thin Android shell: asset server, file picker, text-to-speech bridge, foreground service. |
| `web-tests/` | Unit tests for the text logic (`npm test`) and an end-to-end check of the whole app. |
| `tools/glyph-table/` | Builds the table of what the glyphs of known fonts really are (for PDFs with a wrong text map). |
| `.github/workflows/main.yml` | Runs the unit tests, then builds the APK on GitHub's servers (Gradle 8.7, JDK 17). |

Build note: this repo has no Gradle wrapper. CI pins Gradle 8.7; Android Studio manages its own. If you build
with a newer standalone Gradle (9.x) and AGP 8.5.2 fails, use Gradle 8.7 (`gradle wrapper --gradle-version 8.7`).

## Supported files

* **PDF**: every page is drawn; tap a line to read from it. PDFs whose text layer is broken (old Hindi fonts, lost matras)
  are repaired from the page's glyphs, or read from the page picture with Gemini (see ARCHITECTURE.md).
* **Word (.docx)**: shown as text parts; tap any sentence to read from it, the sentence being read is highlighted. Zoom
  changes the text size. Old `.doc` files: open them in Word and Save As `.docx` first. Text typed in an old non-Unicode
  Hindi font (Kruti Dev) cannot be read; re-save it with a Unicode font such as Mangal.

## Using the player

- ▶ reads from the top of the page you're on; tapping a line starts reading from that line.
- ⏮ ⏭ jump by sentence (across pages), ■ stops, the speed button opens a 0.5×–2× slider, ∞ keeps reading until you stop.
- Pinch (or the + / − buttons) zooms the pages; 🌙 turns on dark pages.
- Reading is sentence-by-sentence, so intonation stays natural across line breaks.
- The app remembers the page you were on for each PDF. Gemini-read pages are cached in IndexedDB.

The page detects `window.AndroidTTS` and uses it when present; in a normal browser it falls back to the Web Speech API.
To change the UI or behaviour, edit the files under `app/src/main/assets/` and rebuild — Kotlin changes are only needed
for native features. The same files run in a desktop browser (serve the folder with any static server).
