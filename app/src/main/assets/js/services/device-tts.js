// The device's own text-to-speech: the browser's Web Speech API, or Android's native engine through the
// `window.AndroidTTS` bridge that MainActivity injects (WebView has no Web Speech, and the native engine is better
// for Hindi anyway). Both adapters expose the same interface:
//
//   available, getVoices(), onchange(cb), speak(text, voice, rate, job, queue), cancel(), setPlaying(on, title)
//
// A `job` is { onend, onerror, cancelled }; an adapter must stay silent once job.cancelled is set.

import { emit } from '../core/bus.js';

function createWebTts() {
  const available = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let onVoicesChanged = null;
  if (available) speechSynthesis.onvoiceschanged = () => onVoicesChanged && onVoicesChanged();

  return {
    available,
    getVoices() {
      if (!available) return [];
      return speechSynthesis.getVoices().map((v) => ({
        id: v.voiceURI, name: v.name, lang: v.lang, online: !v.localService, _voice: v
      }));
    },
    onchange(callback) { onVoicesChanged = callback; },
    speak(text, voice, rate, job) {
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice && voice._voice) { utterance.voice = voice._voice; utterance.lang = voice.lang; } else { utterance.lang = 'hi-IN'; }
      utterance.rate = rate;
      utterance.onend = () => { if (!job.cancelled && job.onend) job.onend(); };
      utterance.onerror = (event) => {
        if (job.cancelled || event.error === 'interrupted' || event.error === 'canceled') return;
        if (job.onerror) job.onerror(event.error);
      };
      setTimeout(() => { if (!job.cancelled) speechSynthesis.speak(utterance); }, 60);
    },
    cancel() { if (available) speechSynthesis.cancel(); },
    setPlaying() { /* the browser needs no keep-alive */ }
  };
}

function createAndroidTts() {
  const bridge = window.AndroidTTS;
  const jobs = {};
  let counter = 0;
  let onVoicesChanged = null;

  // Called by MainActivity (see TtsBridge.kt) through evaluateJavascript.
  window.__androidTts = {
    onEnd(id) { const job = jobs[id]; delete jobs[id]; if (job && !job.cancelled && job.onend) job.onend(); },
    onError(id, message) { const job = jobs[id]; delete jobs[id]; if (job && !job.cancelled && job.onerror) job.onerror(message || 'error'); },
    onVoicesChanged() { if (onVoicesChanged) onVoicesChanged(); },
    onPauseRequested() { emit('player:pause'); }
  };

  return {
    available: true,
    getVoices() {
      try { return JSON.parse(bridge.getVoices() || '[]'); } catch (err) { return []; }
    },
    onchange(callback) { onVoicesChanged = callback; },
    speak(text, voice, rate, job, queue) {
      const id = 'u' + (++counter);
      jobs[id] = job;
      // queue=true joins the engine's queue instead of cutting the previous sentence (online voices report "done" early)
      bridge.speak(text, voice ? voice.id : '', rate, id, !queue);
    },
    cancel() {
      for (const id in jobs) { jobs[id].cancelled = true; delete jobs[id]; }
      bridge.stop();
    },
    /** Lets the native side run a foreground service so reading continues with the screen off. */
    setPlaying(on, title) {
      try { if (bridge.setPlaying) bridge.setPlaying(!!on, title || ''); } catch (err) { /* older shell */ }
    }
  };
}

export const createDeviceTts = () => (window.AndroidTTS ? createAndroidTts() : createWebTts());
