// A short tick when a button is pressed, where the device allows it (Android WebView needs the VIBRATE permission,
// which the app declares). Everything else about touch feedback is CSS (css/theme.css: pressed state, no tap flash).

const TICK_MS = 8;
const PLAY_MS = 14;

export function initHaptics() {
  if (!navigator.vibrate) return;
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest && event.target.closest('.btn');
    if (!button || button.disabled) return;
    try { navigator.vibrate(button.id === 'playBtn' ? PLAY_MS : TICK_MS); } catch (err) { /* not allowed here */ }
  }, { passive: true });
}
