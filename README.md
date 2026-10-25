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

| Path | What it is |
|---|---|
| `app/src/main/assets/index.html` | The entire app UI and logic (same file runs in a browser). |
| `app/src/main/assets/pdfjs/` | pdf.js, downloaded by the scripts / CI so the app works offline. |
| `MainActivity.kt` | WebView shell: system file picker + `window.AndroidTTS` bridge to native speech. |
| `SpeechService.kt` | Foreground service + notification (with Pause) so reading continues with the screen off. |
| `.github/workflows/main.yml` | Builds the APK on GitHub's servers (Gradle 8.7, JDK 17). |

Build note: this repo has no Gradle wrapper. CI pins Gradle 8.7; Android Studio manages its own. If you build
with a newer standalone Gradle (9.x) and AGP 8.5.2 fails, use Gradle 8.7 (`gradle wrapper --gradle-version 8.7`).

## Using the player

- ▶ reads from the top of the page you're on; tapping a line starts at that sentence.
- ⏮ ⏭ jump by sentence (across pages), ■ stops, the speed button cycles 0.75×–2×, ∞ keeps reading until you stop.
- Reading is sentence-by-sentence, so intonation stays natural across line breaks.
- The app remembers the page you were on for each PDF. Gemini-read pages are cached in IndexedDB.

The page detects `window.AndroidTTS` and uses it when present; in a normal browser it falls back to the Web Speech API.
To change the UI, edit `index.html` and rebuild — no Kotlin changes needed.

## Publishing to the Play Store

The APK is signed with the debug key so it installs directly on any phone. For the Play Store you'll need
your own keystore (`Build → Generate Signed Bundle / APK`) and to change `applicationId` in `app/build.gradle.kts`
to something that's yours, e.g. `in.yourname.pdfvoicereader`.
