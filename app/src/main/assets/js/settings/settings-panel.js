// The settings sheet: reading behaviour and the Gemini key / models.

import { el } from '../core/dom.js';
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { DEFAULT_TEXT_MODEL, DEFAULT_TTS_MODEL } from '../core/config.js';
import { hasKey, persistSettings, settings } from '../core/store.js';
import { ocrCache } from '../core/ocr-cache.js';
import { geminiCall, listModels, responseText } from '../services/gemini-client.js';
import { setContinuous } from '../player/controls.js';
import { loadVoices } from '../player/voices.js';
import { setNotice } from '../ui/notice.js';

export const isSheetOpen = () => el.sheet.classList.contains('show');

function openSheet() {
  el.apiKey.value = settings.key;
  el.contMode.value = state.cont ? '1' : '0';
  el.ocrMode.value = settings.ocrMode;
  el.textModel.value = settings.textModel;
  el.ttsModel.value = settings.ttsModel;
  showStatus('', '');
  el.scrim.classList.add('show');
  el.sheet.classList.add('show');
  el.apiKey.focus();
}

export function hideSheet() {
  el.scrim.classList.remove('show');
  el.sheet.classList.remove('show');
}

/** @param kind  '' | 'ok' | 'bad' */
function showStatus(text, kind) {
  el.keyStatus.textContent = text;
  el.keyStatus.className = 'status-line' + (kind ? ' ' + kind : '');
}

function save() {
  const hadKey = hasKey();
  setContinuous(el.contMode.value === '1');
  settings.key = el.apiKey.value.trim();
  settings.ocrMode = el.ocrMode.value;
  settings.textModel = el.textModel.value.trim() || DEFAULT_TEXT_MODEL;
  settings.ttsModel = el.ttsModel.value.trim() || DEFAULT_TTS_MODEL;
  persistSettings();
  el.settingsBtn.classList.toggle('dot', hasKey());
  loadVoices();                 // Gemini voices appear / disappear with the key
  hideSheet();
  emit('settings:saved');       // pages re-evaluate whether Gemini should read them
  if (!hadKey && hasKey()) setNotice('Gemini is set up. Pages with garbled text will now be read properly.', false);
}

async function testKey() {
  const key = el.apiKey.value.trim();
  if (!key) { showStatus('Enter a key first.', 'bad'); return; }
  showStatus('Checking…', '');
  const savedKey = settings.key;
  settings.key = key;           // the client reads the key from settings; restore it afterwards
  try {
    const data = await geminiCall(el.textModel.value.trim() || DEFAULT_TEXT_MODEL, {
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
      generationConfig: { maxOutputTokens: 50 }
    });
    const reply = responseText(data).trim().slice(0, 20);
    showStatus('Key works' + (reply ? ' (model replied: ' + reply + ')' : '') + '.', 'ok');
  } catch (err) {
    let message = err.message;
    if (err.status === 404) {
      try {
        const names = await listModels();
        const flash = names.filter((name) => /flash/.test(name)).slice(0, 8);
        message += ' — Model not found. Models your key can use: '
          + (flash.length ? flash.join(', ') : names.slice(0, 8).join(', ') || 'none') + '.';
      } catch (listError) { /* keep the original message */ }
    }
    showStatus(message, 'bad');
  } finally {
    settings.key = savedKey;
  }
}

async function forgetReadPages() {
  const count = await ocrCache.clear();
  showStatus(count ? 'Forgot ' + count + ' read page' + (count === 1 ? '' : 's') + '.' : 'Nothing to forget.', 'ok');
}

export function initSettingsPanel() {
  el.settingsBtn.classList.toggle('dot', hasKey());
  el.settingsBtn.addEventListener('click', openSheet);
  el.bannerBtn.addEventListener('click', openSheet);
  el.closeSheet.addEventListener('click', hideSheet);
  el.scrim.addEventListener('click', hideSheet);
  el.showKey.addEventListener('click', () => {
    const reveal = el.apiKey.type === 'password';
    el.apiKey.type = reveal ? 'text' : 'password';
    el.showKey.textContent = reveal ? 'Hide' : 'Show';
  });
  el.saveSettings.addEventListener('click', save);
  el.testKey.addEventListener('click', testKey);
  el.clearCache.addEventListener('click', forgetReadPages);
}
