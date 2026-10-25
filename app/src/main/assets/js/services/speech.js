// One entry point for speaking: routes a sentence to a Gemini voice or the device engine and keeps track of the
// single job that is currently allowed to report back (older jobs are marked cancelled so they go silent).

import { createDeviceTts } from './device-tts.js';
import { geminiVoice } from './gemini-voice.js';

export const deviceTts = createDeviceTts();

let currentJob = null;

/** Starts a new job; the previous one can no longer call back. */
export function newJob(onend, onerror) {
  if (currentJob) currentJob.cancelled = true;
  currentJob = { onend, onerror, cancelled: false };
  return currentJob;
}

/** Makes the current job silent (pause / stop / a newer sentence is about to start). */
export function cancelJob() {
  if (currentJob) currentJob.cancelled = true;
  currentJob = null;
}

/** Stops whatever is audible right now. */
export function stopAudio() {
  deviceTts.cancel();
  geminiVoice.cancel();
}

/**
 * @param voice  a voice object from player/voices.js (or null for the engine default)
 * @param queue  true when moving on to the next sentence by itself: let the engine finish the previous tail
 */
export function speakText(text, voice, rate, job, queue) {
  if (voice && voice.gemini) geminiVoice.speak(text, voice.name, rate, job);
  else if (deviceTts.available) deviceTts.speak(text, voice, rate, job, queue);
  else if (job.onerror) job.onerror('no speech engine');
}

export const prefetchGemini = (text, voice) => geminiVoice.prefetch(text, voice.name);
export const setPlaybackRate = (rate) => geminiVoice.setRate(rate);
