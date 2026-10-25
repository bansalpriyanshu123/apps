// End-to-end check of the whole web app through the Chrome DevTools protocol: boot, open a PDF, render, text quality
// (no lost-glyph placeholders, expected Hindi words), tap a line, pause / stop, zoom (buttons + pinch), pinned header,
// dark pages, settings, and "no console errors". Needs Node 22 (built-in WebSocket) and a PDF to open.
//
// A) Desktop Chrome (no phone needed):
//    1. python -m http.server 8765 --bind 127.0.0.1        (run inside app/src/main/assets)
//    2. chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<temp dir> about:blank
//    3. node web-tests/e2e/run.mjs <file.pdf> all
//
// B) The real app on a USB-debugging phone, using the web files from this checkout instead of the installed ones
//    (no rebuild needed; speech goes through the real Android bridge):
//    1. install the app, open it, keep the screen on (adb shell svc power stayon usb)
//    2. adb forward tcp:9222 localabstract:webview_devtools_remote_<pid of the app>
//    3. PORT=9222 URL=https://appassets.androidapp.com/assets/index.html EMULATE=0 //         INJECT_DIR=app/src/main/assets node web-tests/e2e/run.mjs <file.pdf> all
//
// steps: smoke | text | tap | zoom | dark | settings | all
// env:   PORT, URL, EMULATE, INJECT_DIR, INJECT_WAIT (ms), OUT (screenshot folder),
//        TEXT_PAGES (how many pages the text step reads, default 10), EXPECT_WORDS (comma separated words that must appear)

import fs from 'node:fs';
import os from 'node:os';

const PORT = Number(process.env.PORT || 9333);
const APP_URL = process.env.URL || 'http://127.0.0.1:8765/index.html';
const EMULATE = process.env.EMULATE !== '0';
const pdfPath = process.argv[2];
const steps = process.argv.slice(3);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];
const report = {};
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(msg.params.type)) {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) { console.error('page exceptions so far:', exceptions, 'console errors:', consoleErrors, 'report so far:', JSON.stringify(report)); }
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${process.env.OUT || os.tmpdir()}/pvr-e2e-${name}.png`, Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
if (EMULATE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
}
await send('Page.navigate', { url: APP_URL });
await wait(3500);

// Optional: test a local assets folder inside the app's real WebView without rebuilding the APK. The page is replaced
// in memory by the new index.html; its modules come from blob: URLs through an import map. The app keeps serving
// pdfjs/, and window.AndroidTTS stays connected, so speech goes through the real Android bridge.
const INJECT_DIR = process.env.INJECT_DIR;
if (INJECT_DIR) {
  const ORIGIN = 'https://appassets.androidapp.com/assets/';
  // The installed app may already have loaded its own copies of these modules into this page, and a page keeps its
  // module cache. Move to a plain static file on the same origin first (a 404 page would have an opaque origin) so the injected modules are the ones that run.
  await send('Page.navigate', { url: ORIGIN + 'css/theme.css' });
  await wait(1500);
  const files = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(`${dir}/${rel}`, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(dir, path);
      else if (path.startsWith('js/') && path.endsWith('.js')) files[ORIGIN + path] = fs.readFileSync(`${dir}/${path}`, 'utf8');
    }
  };
  walk(INJECT_DIR, 'js');
  for (const [url, source] of Object.entries(files)) {
    files[url] = source.replace(/(from\s+)'(\.[^']+)'/g, (m, f, spec) => `${f}'${new URL(spec, url).href}'`);
  }
  let html = fs.readFileSync(`${INJECT_DIR}/index.html`, 'utf8');
  html = html.replace('<head>', `<head><base href="${ORIGIN}">`);   // the temporary page lives in css/: keep relative URLs (pdfjs/) pointing at assets/
  html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, href) => `<style>${fs.readFileSync(`${INJECT_DIR}/${href}`, 'utf8')}</style>`);
  html = html.replace('<script type="module" src="js/main.js"></script>',
    `<script type="importmap">__IMPORTMAP__</script><script type="module">import '${ORIGIN}js/main.js';</script>`);   // import maps remap imports, not <script src>
  // start from default preferences (zoom 100%, light pages, ...), not whatever earlier sessions left on the device
  await evaluate(`['pvr-zoom','pvr-dark','pvr-rate','pvr-cont','pvr-voice'].forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage).filter((k) => k.startsWith('pvr-pos:')).forEach((k) => localStorage.removeItem(k)); 0`);
  const injected = await evaluate(`(() => {
    const files = ${JSON.stringify(files)};
    const imports = {};
    for (const [url, source] of Object.entries(files)) imports[url] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const html = ${JSON.stringify(html)}.replace('__IMPORTMAP__', JSON.stringify({ imports }));
    document.open(); document.write(html); document.close();
    return Object.keys(files).length;
  })()`);
  console.error('injected modules:', injected);
  await wait(Number(process.env.INJECT_WAIT || 9000));
}

const ok = (name, cond, extra) => { report[name] = cond ? 'PASS' : 'FAIL' + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''); };

// --- smoke: modules loaded, markup wired ---
const boot = await evaluate(`JSON.stringify({
  title: document.title,
  pdfjs: typeof window.pdfjsLib,
  voiceOptions: document.getElementById('voice').options.length,
  playIcon: document.getElementById('playBtn').innerHTML.length > 0,
  speedLabel: document.getElementById('speedBtn').textContent,
  zoomLabel: document.getElementById('zoomVal').textContent,
  barH: getComputedStyle(document.documentElement).getPropertyValue('--bar-h')
})`);
const b = JSON.parse(boot);
ok('boot: pdf.js loaded', b.pdfjs === 'object', b);
ok('boot: play icon rendered', b.playIcon);
ok('boot: speed label set', /×/.test(b.speedLabel), b.speedLabel);
ok('boot: header height synced', parseFloat(b.barH) > 0, b.barH);

// --- open the PDF (same path a user takes: file input change) ---
const b64 = fs.readFileSync(pdfPath).toString('base64');
const opened = await evaluate(`(async () => {
  const bin = atob('${b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], 'test.pdf', { type: 'application/pdf' }));
  const input = document.getElementById('fileInput'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 4500));
  return JSON.stringify({ pages: document.querySelectorAll('.page-wrap').length, total: document.getElementById('pageTotal').textContent,
    notice: document.getElementById('notice').textContent, emptyHidden: document.getElementById('empty').style.display === 'none',
    nowBar: getComputedStyle(document.getElementById('now')).display, zoombar: getComputedStyle(document.getElementById('zoombar')).display });
})()`);
const o = JSON.parse(opened);
ok('open: pages created', o.pages > 1 && String(o.pages) === o.total, o);
ok('open: player + zoom shown', o.nowBar !== 'none' && o.zoombar !== 'none', o);

const paintedPages = async () => JSON.parse(await evaluate(`(() => { const out = { visible: 0, blank: 0 };
  for (const w of document.querySelectorAll('.page-wrap')) { const r = w.getBoundingClientRect(); if (r.bottom < 60 || r.top > innerHeight - 200) continue;
    out.visible++; const c = w.querySelector('canvas'); let painted = 0;
    if (c.width) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4 * 97) { if (d[i + 3] > 0) { painted = 1; break; } } }
    if (!painted) out.blank++; } return JSON.stringify(out); })()`));

await wait(1500);
const first = await paintedPages();
ok('render: first page painted', first.visible > 0 && first.blank === 0, first);
await shot('1-opened');

if (steps.includes('text') || steps.includes('all')) {
  // Every line of the first pages must be free of placeholders; EXPECT_WORDS (comma separated) must all appear.
  const pagesToScan = Number(process.env.TEXT_PAGES || 10);
  const lines = JSON.parse(await evaluate(`(async () => { const out = [];
    for (let p = 1; p <= ${pagesToScan}; p++) { const w = document.querySelector('.page-wrap[data-page="' + p + '"]'); if (!w) break;
      w.scrollIntoView({ block: 'start' }); await new Promise(r => setTimeout(r, 700)); out.push(...[...w.querySelectorAll('.line')].map(l => l.title)); }
    window.scrollTo(0, 0); return JSON.stringify(out); })()`));
  const leftovers = lines.filter((l) => /[ �-]/.test(l));
  ok('text: no lost-glyph placeholders left in the first pages', lines.length > 0 && leftovers.length === 0, leftovers.slice(0, 3));
  const expected = (process.env.EXPECT_WORDS || '').split(',').map((w) => w.trim()).filter(Boolean);
  const missing = expected.filter((w) => !lines.some((l) => l.includes(w)));
  if (expected.length) ok('text: expected words are read correctly (' + expected.length + ')', missing.length === 0, missing);
  const glued = lines.filter((l) => /(अर्थात्|परिषद्|संसद्)[क-ह]/.test(l));
  ok('text: words ending in a halant keep the space after them', glued.length === 0, glued.slice(0, 2));
}

if (steps.includes('tap') || steps.includes('all')) {
  const t = JSON.parse(await evaluate(`(async () => {
    const lines = [...document.querySelectorAll('.page-wrap')][0].querySelectorAll('.line');
    const info = { lines: lines.length };
    lines[3].click(); await new Promise(r => setTimeout(r, 1200));
    info.activeBoxes = document.querySelectorAll('.line.active').length;
    info.playing = document.getElementById('now').classList.contains('playing');
    info.nowText = document.getElementById('nowText').textContent.slice(0, 60);
    info.meta = document.getElementById('nowMeta').textContent;
    document.getElementById('playBtn').click();                     // pause
    await new Promise(r => setTimeout(r, 400));
    info.pausedPlaying = document.getElementById('now').classList.contains('playing');
    info.stopEnabled = !document.getElementById('stopBtn').disabled;
    document.getElementById('stopBtn').click();
    await new Promise(r => setTimeout(r, 300));
    info.afterStopActive = document.querySelectorAll('.line.active').length;
    info.idleText = document.getElementById('nowText').classList.contains('idle');
    return JSON.stringify(info); })()`));
  ok('tap: line tap starts reading that line', t.playing && t.activeBoxes >= 1 && t.nowText.length > 0, t);
  ok('tap: pause works', t.pausedPlaying === false && t.stopEnabled, t);
  ok('tap: stop clears highlight', t.afterStopActive === 0 && t.idleText, t);
  await shot('2-after-tap');
}

if (steps.includes('zoom') || steps.includes('all')) {
  const results = [];
  for (const [action, wantZoom] of [['zoomIn', '125%'], ['zoomIn', '150%'], ['zoomOut', '125%'], ['zoomVal', '100%']]) {
    await evaluate(`document.getElementById('${action}').click()`);
    await wait(2500);
    const z = JSON.parse(await evaluate(`JSON.stringify({ label: document.getElementById('zoomVal').textContent,
      pageW: Math.round(document.querySelector('.page-wrap').getBoundingClientRect().width), scrollW: document.documentElement.scrollWidth, innerW: innerWidth })`));
    const p = await paintedPages();
    results.push({ action, label: z.label, pageW: z.pageW, scrollW: z.scrollW, blank: p.blank, visible: p.visible });
    ok(`zoom: ${action} -> ${wantZoom}`, z.label === wantZoom && p.blank === 0, { z, p });
  }
  ok('zoom: zoomed-in page overflows sideways, 100% does not', results[1].scrollW > results[1].pageW && results[3].scrollW <= 412 + 2, results);
  // header must stay pinned while scrolled sideways
  await evaluate(`document.getElementById('zoomIn').click(); document.getElementById('zoomIn').click()`);
  await wait(2500);
  const h = JSON.parse(await evaluate(`(async () => { window.scrollTo(150, 400); await new Promise(r => setTimeout(r, 400));
    const r = document.getElementById('bar').getBoundingClientRect(); return JSON.stringify({ scrollX: Math.round(scrollX), barLeft: Math.round(r.left), barW: Math.round(r.width) }); })()`));
  ok('zoom: header stays pinned when scrolled sideways', h.scrollX > 0 && h.barLeft === 0, h);
  // pinch gesture
  await evaluate(`document.getElementById('zoomVal').click()`);
  await wait(1500);
  await send('Input.synthesizePinchGesture', { x: 200, y: 300, scaleFactor: 2, relativeSpeed: 400, gestureSourceType: 'touch' });
  await wait(3500);
  const pz = JSON.parse(await evaluate(`JSON.stringify({ label: document.getElementById('zoomVal').textContent, transform: document.getElementById('pages').style.transform || 'none' })`));
  const pp = await paintedPages();
  ok('zoom: pinch zooms in and leaves nothing blank', parseInt(pz.label) > 150 && pz.transform === 'none' && pp.blank === 0, { pz, pp });
  await shot('3-pinched');
  await evaluate(`document.getElementById('zoomVal').click()`);
  await wait(1500);
}

if (steps.includes('dark') || steps.includes('all')) {
  const d = JSON.parse(await evaluate(`(async () => {
    document.getElementById('darkBtn').click(); await new Promise(r => setTimeout(r, 2500));
    const c = document.querySelector('.page-wrap canvas'); const px = c.getContext('2d').getImageData(5, 5, 1, 1).data;
    const out = { theme: document.documentElement.getAttribute('data-theme'), cls: document.getElementById('pages').className, cornerPixel: [px[0], px[1], px[2]] };
    document.getElementById('darkBtn').click(); await new Promise(r => setTimeout(r, 2500));
    const px2 = c.getContext('2d').getImageData(5, 5, 1, 1).data;
    out.afterOff = { theme: document.documentElement.getAttribute('data-theme'), cornerPixel: [px2[0], px2[1], px2[2]] };
    return JSON.stringify(out); })()`));
  ok('dark: pages invert (dark corner) and revert (white corner)', d.cornerPixel[0] < 60 && d.afterOff.cornerPixel[0] > 200 && d.theme === 'dark' && d.afterOff.theme === null, d);
}

if (steps.includes('settings') || steps.includes('all')) {
  const s = JSON.parse(await evaluate(`(async () => {
    document.getElementById('settingsBtn').click(); await new Promise(r => setTimeout(r, 400));
    const opened = document.getElementById('sheet').classList.contains('show');
    document.getElementById('apiKey').value = 'AIzaFAKEKEYFORTEST'; document.getElementById('contMode').value = '0';
    document.getElementById('saveSettings').click(); await new Promise(r => setTimeout(r, 400));
    const out = { opened, closedAfterSave: !document.getElementById('sheet').classList.contains('show'),
      dot: document.getElementById('settingsBtn').classList.contains('dot'), cont: document.getElementById('contBtn').getAttribute('aria-pressed'),
      keyStored: localStorage.getItem('pvr-gemini-key') === 'AIzaFAKEKEYFORTEST', geminiVoices: [...document.getElementById('voice').options].filter(o => /^Kore|Puck/.test(o.textContent)).length };
    // undo
    localStorage.removeItem('pvr-gemini-key'); localStorage.setItem('pvr-cont', '1');
    return JSON.stringify(out); })()`));
  ok('settings: sheet opens, saves, closes; key + continue switch applied', s.opened && s.closedAfterSave && s.dot && s.cont === 'false' && s.keyStored && s.geminiVoices >= 2, s);
}

ok('no uncaught exceptions', exceptions.length === 0, exceptions);
const relevantErrors = consoleErrors.filter((e) => !/favicon|fonts.googleapis|ERR_BLOCKED|speech/i.test(e));
ok('no console errors', relevantErrors.length === 0, relevantErrors);

console.log(JSON.stringify(report, null, 1));
const failed = Object.values(report).filter((v) => v.startsWith('FAIL')).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
ws.close();
process.exit(failed ? 1 : 0);
