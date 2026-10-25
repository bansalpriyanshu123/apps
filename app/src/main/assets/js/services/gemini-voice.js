// Gemini text-to-speech voices (Kore, Puck, ...). Online only; audio is cached per sentence and prefetched.

import { settings } from '../core/store.js';
import { geminiCall } from './gemini-client.js';

const MAX_CACHED = 60;
const cache = new Map();   // "voice|model|text" -> Promise<blob URL>
let audio = null;

function pcmToWav(bytes, sampleRate) {
  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + bytes.length, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, bytes.length, true);
  new Uint8Array(buffer, 44).set(bytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

async function requestAudio(text, voiceName) {
  const data = await geminiCall(settings.ttsModel, {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    }
  });
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const part = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw new Error('Gemini returned no audio.');

  const mime = part.inlineData.mimeType || '';
  const rate = /rate=(\d+)/.exec(mime);
  const sampleRate = rate ? parseInt(rate[1], 10) : 24000;
  const binary = atob(part.inlineData.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = /wav|mpeg|ogg/.test(mime) ? new Blob([bytes], { type: mime }) : pcmToWav(bytes, sampleRate);
  return URL.createObjectURL(blob);
}

function audioUrl(text, voiceName) {
  const key = voiceName + '|' + settings.ttsModel + '|' + text;
  if (cache.has(key)) return cache.get(key);
  const promise = requestAudio(text, voiceName);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    cache.get(oldest).then((url) => URL.revokeObjectURL(url), () => {});
    cache.delete(oldest);
  }
  return promise;
}

export const geminiVoice = {
  /** Start fetching a sentence's audio in the background. */
  prefetch(text, voiceName) { audioUrl(text, voiceName).catch(() => {}); },

  async speak(text, voiceName, rate, job) {
    let url;
    try {
      url = await audioUrl(text, voiceName);
    } catch (err) {
      if (!job.cancelled && job.onerror) job.onerror(err.message);
      return;
    }
    if (job.cancelled) return;
    this.cancel();
    audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = rate;
    audio.onended = () => { if (!job.cancelled && job.onend) job.onend(); };
    audio.onerror = () => { if (!job.cancelled && job.onerror) job.onerror('playback failed'); };
    try {
      await audio.play();
    } catch (err) {
      if (!job.cancelled && job.onerror) job.onerror('playback blocked: ' + err.message);
    }
  },

  setRate(rate) { if (audio) audio.playbackRate = rate; },
  cancel() {
    if (!audio) return;
    audio.onended = audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
};
