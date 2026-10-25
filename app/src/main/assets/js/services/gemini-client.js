// Thin client for the Gemini REST API: auth header, retry on rate limits, readable errors.

import { GEMINI_API_ROOT, IN_ANDROID_APP } from '../core/config.js';
import { settings } from '../core/store.js';
import { sleep } from '../core/util.js';

function friendlyFetchError(err) {
  if (err && err.name === 'TypeError') {
    return IN_ANDROID_APP
      ? 'Could not reach Gemini. Check your internet connection.'
      : 'This hosted preview blocks calls to Google. Gemini works in the Android app or when you run the HTML file from your own computer.';
  }
  return (err && err.message) || String(err);
}

async function request(url, init) {
  // Free-tier keys hit 429/503 in bursts: back off and retry a couple of times.
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.key },
        ...init
      });
    } catch (err) {
      throw new Error(friendlyFetchError(err));
    }
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status === 503) && attempt < 3) { await sleep(1500 * attempt); continue; }

    let message = response.status + ' ' + response.statusText;
    try {
      const body = await response.json();
      if (body.error && body.error.message) message = body.error.message;
    } catch (err) { /* keep the status text */ }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
}

/** models/<model>:generateContent */
export function geminiCall(model, body) {
  return request(GEMINI_API_ROOT + 'models/' + encodeURIComponent(model) + ':generateContent',
    { method: 'POST', body: JSON.stringify(body) });
}

/** Names of the models the key may call generateContent on. */
export async function listModels() {
  const data = await request(GEMINI_API_ROOT + 'models?pageSize=200', { method: 'GET' });
  return (data.models || [])
    .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
    .map((model) => String(model.name).replace(/^models\//, ''));
}

/** The text parts of a generateContent response, joined. */
export function responseText(data) {
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map((part) => part.text || '').join('');
}
