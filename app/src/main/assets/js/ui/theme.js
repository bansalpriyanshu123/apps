// Dark pages: the whole app goes dark and the PDF pages are drawn inverted (white paper -> black).
// Off goes back to following the system theme.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { PREF } from '../core/config.js';
import { loadPref, savePref } from '../core/store.js';

export function setDarkPages(on) {
  state.darkPages = on;
  if (on) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  el.pages.classList.toggle('dark', on);
  el.darkBtn.classList.toggle('on', on);
  el.darkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  savePref(PREF.dark, on ? '1' : '0');
  emit('theme:dark', on);       // the renderer redraws the pages in the new colours
}

export function initTheme() {
  setDarkPages(loadPref(PREF.dark, '0') === '1');
  el.darkBtn.addEventListener('click', () => setDarkPages(!state.darkPages));
}
