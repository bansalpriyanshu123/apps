// Wiring of the player bar's buttons: play / pause / stop / previous / next, the speed panel, the
// "keep reading" switch and the voice test.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { PREF, RATE, SAMPLE_SENTENCE } from '../core/config.js';
import { loadPref, savePref } from '../core/store.js';
import { clamp } from '../core/util.js';
import { newJob, setPlaybackRate, speakText } from '../services/speech.js';
import { setNotice } from '../ui/notice.js';
import { initMediaSession } from './now-bar.js';
import { pause, restartCurrent, step, stop, togglePlay } from './playback.js';
import { loadVoices, selectedVoice } from './voices.js';

/** Any speed from 0.5x to 2x in 0.05 steps. */
export function setRate(requested) {
  const stepped = Math.round(clamp(requested || 1, RATE.min, RATE.max) / RATE.step) * RATE.step;
  state.rate = Math.round(stepped * 100) / 100;
  const label = state.rate.toFixed(2).replace(/0$/, '') + '×';
  el.speedBtn.textContent = label;
  el.speedVal.textContent = label;
  el.speedRange.value = state.rate;
  savePref(PREF.rate, String(state.rate));
  setPlaybackRate(state.rate);       // Gemini audio changes speed live
}

/** "Keep reading until I press Stop" (the ∞ button, also a setting). */
export function setContinuous(on) {
  state.cont = !!on;
  el.contBtn.classList.toggle('on', state.cont);
  el.contBtn.setAttribute('aria-pressed', state.cont ? 'true' : 'false');
  savePref(PREF.cont, state.cont ? '1' : '0');
}

export function closeSpeedPanel() { el.speedPop.classList.remove('show'); }
export const isSpeedPanelOpen = () => el.speedPop.classList.contains('show');

export function initControls() {
  setRate(parseFloat(loadPref(PREF.rate, '1')) || 1);
  setContinuous(loadPref(PREF.cont, '1') === '1');

  el.playBtn.addEventListener('click', togglePlay);
  el.stopBtn.addEventListener('click', stop);
  el.prevSeg.addEventListener('click', () => step(-1));
  el.nextSeg.addEventListener('click', () => step(1));
  el.contBtn.addEventListener('click', () => setContinuous(!state.cont));
  initMediaSession({ play: togglePlay, pause, previous: () => step(-1), next: () => step(1) });

  // Device voices need the current sentence restarted to change speed; wait until the slider / buttons settle.
  let restartTimer = null;
  const changeRate = (rate) => {
    setRate(rate);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      const voice = selectedVoice();
      if (!(voice && voice.gemini)) restartCurrent();
    }, 450);
  };
  el.speedBtn.addEventListener('click', () => el.speedPop.classList.toggle('show'));
  el.speedRange.addEventListener('input', () => changeRate(parseFloat(el.speedRange.value)));
  el.speedDown.addEventListener('click', () => changeRate(state.rate - RATE.step));
  el.speedUp.addEventListener('click', () => changeRate(state.rate + RATE.step));
  el.speedPop.querySelectorAll('[data-speed]').forEach((button) =>
    button.addEventListener('click', () => changeRate(parseFloat(button.dataset.speed))));
  document.addEventListener('pointerdown', (event) => {
    if (isSpeedPanelOpen() && !el.speedPop.contains(event.target) && event.target !== el.speedBtn) closeSpeedPanel();
  });

  // "Hear the selected voice" in the settings sheet
  el.testVoice.addEventListener('click', () => {
    if (!state.voices.length) loadVoices();
    stop();
    const job = newJob(() => {}, (message) => setNotice('Voice test failed: ' + message, true));
    speakText(SAMPLE_SENTENCE, selectedVoice(), state.rate, job);
  });
}
