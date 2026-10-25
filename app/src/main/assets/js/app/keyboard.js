// Keyboard shortcuts (desktop and Bluetooth keyboards).
//   Space play/pause   <- / -> previous / next sentence   + / - / 0 zoom   Esc close the panel, else stop

import { state } from '../core/state.js';
import { ZOOM } from '../core/config.js';
import { closeSpeedPanel, isSpeedPanelOpen } from '../player/controls.js';
import { step, stop, togglePlay } from '../player/playback.js';
import { hideSheet, isSheetOpen } from '../settings/settings-panel.js';
import { setZoom, zoomBy } from '../viewer/zoom.js';

export function initKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isSpeedPanelOpen()) closeSpeedPanel();
      else if (isSheetOpen()) hideSheet();
      else stop();
      return;
    }
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.target.classList.contains('line')) return;
    if (!state.doc) return;

    if (event.key === ' ') { event.preventDefault(); togglePlay(); }
    else if (event.key === '+' || event.key === '=') zoomBy(ZOOM.step);
    else if (event.key === '-' || event.key === '_') zoomBy(-ZOOM.step);
    else if (event.key === '0') setZoom(1);
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
  });
}
