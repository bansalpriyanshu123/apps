// Cache of pages that Gemini has already read, so each page is paid for once.
// Lives in IndexedDB (localStorage's ~5 MB fills up quickly with OCR text); entries written by older versions
// into localStorage are still honoured and are cleared together with the rest.

import { OCR_KEY_PREFIX } from './config.js';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const request = indexedDB.open('pvr', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('ocr');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function transaction(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('ocr', mode);
    const request = work(tx.objectStore('ocr'));
    tx.oncomplete = () => resolve(request && request.result);
    tx.onerror = () => reject(tx.error);
  }));
}

export const ocrCache = {
  /** The cached lines for a key, or undefined. */
  async get(key) {
    const fromDb = await transaction('readonly', (store) => store.get(key)).catch(() => undefined);
    if (fromDb) return fromDb;
    try {
      const legacy = localStorage.getItem(key);
      return legacy ? JSON.parse(legacy) : undefined;
    } catch (err) {
      return undefined;
    }
  },

  async set(key, lines) {
    await transaction('readwrite', (store) => store.put(lines, key)).catch(() => {});
  },

  /** Forget everything. Resolves to how many pages were forgotten. */
  async clear() {
    let removed = await transaction('readonly', (store) => store.count()).catch(() => 0);
    await transaction('readwrite', (store) => store.clear()).catch(() => {});
    try {
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(OCR_KEY_PREFIX)) legacyKeys.push(key);
      }
      legacyKeys.forEach((key) => { localStorage.removeItem(key); removed++; });
    } catch (err) { /* ignore */ }
    return removed;
  }
};
