// The "now playing" bar at the bottom: the sentence being read, its position, and the play / stop button states.
// Presentation only; the playback logic is in playback.js.

import { el } from '../core/dom.js';
import { IDLE_TEXT } from '../core/config.js';

const icon = (name) => '<svg class="ic ic-lg" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const PLAY_ICON = icon('play');
const PAUSE_ICON = icon('pause');

export function showNowBar() { el.now.classList.add('show'); }

export function showIdle() {
  el.nowText.textContent = IDLE_TEXT;
  el.nowText.classList.add('idle');
  el.nowMeta.textContent = '';
}

export function showPreparing(pageNumber) {
  el.nowText.textContent = 'Preparing page ' + pageNumber + '…';
  el.nowText.classList.add('idle');
}

export function showSentence(text, meta) {
  el.nowText.textContent = text;
  el.nowText.classList.remove('idle');
  el.nowMeta.textContent = meta;
}

/** @param canStop  there is something to stop (playing, paused mid-sentence, or a sentence highlighted) */
export function renderPlayState(playing, canStop) {
  el.playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  el.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.now.classList.toggle('playing', playing);
  el.stopBtn.disabled = !canStop;
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (err) { /* unsupported */ }
  }
}

/** Lock-screen / headset controls, where the platform offers them. */
export function initMediaSession({ play, pause, previous, next }) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('previoustrack', previous);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  } catch (err) { /* some actions are unsupported */ }
}
