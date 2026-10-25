// Constants and environment facts. No logic, no DOM access, no imports.

/** True when the page is served by the Android shell (see MainActivity.serveAsset). */
export const IN_ANDROID_APP = location.hostname === 'appassets.androidapp.com';

export const PDFJS_VERSION = '3.11.174';
export const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;

export const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/';
export const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Leda', 'Aoede', 'Orus'];

export const RATE = { min: 0.5, max: 2, step: 0.05 };
export const ZOOM = { min: 0.5, max: 3, step: 0.25 };

/** Sentinel for "the last sentence of the page" when stepping backwards across a page boundary. */
export const LAST = Infinity;

export const SAMPLE_SENTENCE = 'नमस्ते। यह आवाज़ का नमूना है। आप गति बदल सकते हैं।';
export const IDLE_TEXT = 'Tap any line, or press ▶ to read from this page.';

/** localStorage keys (per device). */
export const PREF = {
  geminiKey: 'pvr-gemini-key',
  ocrMode: 'pvr-ocr-mode',
  textModel: 'pvr-text-model',
  ttsModel: 'pvr-tts-model',
  rate: 'pvr-rate',
  cont: 'pvr-cont',
  zoom: 'pvr-zoom',
  dark: 'pvr-dark',
  voice: 'pvr-voice',
  position: (pdfId) => 'pvr-pos:' + pdfId
};

/** Prefix of OCR cache keys ("pvr-ocr:<pdf id>:<page>"). Old versions kept them in localStorage; now IndexedDB. */
export const OCR_KEY_PREFIX = 'pvr-ocr:';
