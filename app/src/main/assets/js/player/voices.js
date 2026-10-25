// The voice list: the device's voices (Hindi first) plus the Gemini voices when an API key is set.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { GEMINI_VOICES, PREF } from '../core/config.js';
import { hasKey, loadPref, savePref } from '../core/store.js';
import { deviceTts } from '../services/speech.js';
import { setNotice } from '../ui/notice.js';
import { syncBarHeight } from '../ui/header.js';

const INDIAN_LANGUAGES = /^(mr|bn|gu|pa|ta|te|kn|ml|ur|ne)/i;

function addGroup(label, voices) {
  if (!voices.length) return;
  const group = document.createElement('optgroup');
  group.label = label;
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.gemini
      ? voice.name
      : voice.name.replace(/^Microsoft |^Google /, '') + (voice.online ? ' · online' : '');
    group.appendChild(option);
  }
  el.voice.appendChild(group);
}

/** (Re)builds the voice picker. Safe to call again when voices arrive late or the API key changes. */
export function loadVoices() {
  const device = deviceTts.available ? deviceTts.getVoices() : [];
  const gemini = hasKey()
    ? GEMINI_VOICES.map((name) => ({ id: 'gemini:' + name, name, lang: 'hi-IN', online: true, gemini: true }))
    : [];

  if (!device.length && !gemini.length) {
    if (!deviceTts.available) {
      setNotice('This browser has no speech support. Add a Gemini key under ⚙ to use Gemini voices, or try Chrome.', true);
      el.voice.innerHTML = '<option value="">No voices</option>';
    }
    return;
  }

  const hindi = device.filter((v) => /^hi/i.test(v.lang));
  const indic = device.filter((v) => !/^hi/i.test(v.lang) && INDIAN_LANGUAGES.test(v.lang));
  const other = device.filter((v) => !hindi.includes(v) && !indic.includes(v));
  state.voices = device.concat(gemini);

  const previous = el.voice.value || loadPref(PREF.voice, '');
  el.voice.innerHTML = '';
  addGroup('Hindi · हिन्दी (device)', hindi);
  addGroup('Gemini voices (online)', gemini);
  addGroup('Other Indian languages', indic);
  addGroup('Other voices', other);

  const choice = state.voices.find((v) => v.id === previous)
    || hindi.find((v) => /google/i.test(v.name))
    || hindi[0] || gemini[0] || state.voices[0];
  if (choice) el.voice.value = choice.id;

  if (!hindi.length && !gemini.length && !state.doc) {
    setNotice('No Hindi voice is installed on this device yet. On Android, install Hindi in Google Text-to-speech, ' +
      'or add a Gemini key under ⚙ for online voices.', false);
  }
  syncBarHeight();
}

export const selectedVoice = () => state.voices.find((voice) => voice.id === el.voice.value) || null;

export function initVoices() {
  loadVoices();
  deviceTts.onchange(loadVoices);
  // Some browsers only list voices after a user gesture.
  const retry = () => { if (!state.voices.length) loadVoices(); };
  document.addEventListener('pointerdown', retry, { passive: true });
  document.addEventListener('keydown', retry);

  el.voice.addEventListener('change', () => {
    savePref(PREF.voice, el.voice.value);
    emit('voice:changed');
  });
}
