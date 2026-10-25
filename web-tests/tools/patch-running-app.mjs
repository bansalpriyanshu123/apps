// Loads the web files of this checkout into the app that is ALREADY RUNNING on a USB-debugging phone, without a rebuild.
// The page is replaced in memory (its modules come from blob: URLs through an import map); the installed Android shell,
// pdf.js, the file picker and the speech bridge stay as they are. It lasts until the app is closed or Android reclaims
// it - run it again after that. Nothing on the phone is changed on disk.
//
//   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid of the app>     (pid: adb shell pidof com.example.pdfvoicereader)
//   node web-tests/tools/patch-running-app.mjs
//
// env: PORT (9222), DIR (app/src/main/assets), WAIT (ms to let the modules start, default 9000)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 9222;
const DIR = process.env.DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/src/main/assets');
const ORIGIN = 'https://appassets.androidapp.com/assets/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};

// modules, with their relative imports made absolute so the import map can swap in the new sources
const files = {};
const walk = (rel) => {
  for (const entry of fs.readdirSync(`${DIR}/${rel}`, { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(p); else if (p.startsWith('js/') && p.endsWith('.js')) files[ORIGIN + p] = fs.readFileSync(`${DIR}/${p}`, 'utf8');
  }
};
walk('js');
for (const [url, source] of Object.entries(files)) {
  files[url] = source.replace(/(from\s+)'(\.[^']+)'/g, (m, from, spec) => `${from}'${new URL(spec, url).href}'`);
}
let html = fs.readFileSync(`${DIR}/index.html`, 'utf8');
html = html.replace('<head>', `<head><base href="${ORIGIN}">`);
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, href) => `<style>${fs.readFileSync(`${DIR}/${href}`, 'utf8')}</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>',
  `<script type="importmap">__IMPORTMAP__</script><script type="module">import '${ORIGIN}js/main.js';</script>`);

// The running page may already have loaded the installed app's own copies of these modules and keeps its module cache,
// so first move to a plain static file on the same origin (a 404 page would have an opaque origin).
await send('Page.navigate', { url: ORIGIN + 'css/theme.css' });
await wait(1500);
const count = await evaluate(`(() => {
  const files = ${JSON.stringify(files)};
  const imports = {};
  for (const [url, source] of Object.entries(files)) imports[url] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  document.open(); document.write(${JSON.stringify(html)}.replace('__IMPORTMAP__', JSON.stringify({ imports }))); document.close();
  return Object.keys(files).length;
})()`);
await wait(Number(process.env.WAIT || 9000));
const booted = await evaluate(`JSON.stringify({ title: document.title, player: document.getElementById('playBtn').innerHTML.length > 0,
  accepts: document.getElementById('fileInput').accept, inApp: !!window.AndroidTTS })`);
console.log(`patched ${count} modules into the running app:`, booted);
process.exit(0);
