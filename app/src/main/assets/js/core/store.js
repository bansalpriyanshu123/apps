// Persisted preferences and user settings (localStorage, per device).

import { DEFAULT_TEXT_MODEL, DEFAULT_TTS_MODEL, PREF } from './config.js';

export function loadPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

export function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch (err) { /* storage unavailable or full: not fatal */ }
}

/** Gemini-related settings edited in the settings sheet. */
export const settings = {
  key: loadPref(PREF.geminiKey, ''),
  ocrMode: loadPref(PREF.ocrMode, 'auto'),     // 'auto' | 'always' | 'never'
  textModel: loadPref(PREF.textModel, '') || DEFAULT_TEXT_MODEL,
  ttsModel: loadPref(PREF.ttsModel, '') || DEFAULT_TTS_MODEL
};

export const hasKey = () => !!settings.key;

export function persistSettings() {
  savePref(PREF.geminiKey, settings.key);
  savePref(PREF.ocrMode, settings.ocrMode);
  savePref(PREF.textModel, settings.textModel);
  savePref(PREF.ttsModel, settings.ttsModel);
}
