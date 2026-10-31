// End-to-end check of the whole web app through the Chrome DevTools protocol: boot, open a PDF, render, text quality
// (no lost-glyph placeholders, expected Hindi words), tap a line, pause / stop, zoom (buttons + pinch), pinned header,
// dark pages, settings, a Word file (parts, tap a sentence, highlight, zoom, dark, paging), and "no console errors".
// Needs Node 22 (built-in WebSocket) and a PDF to open; the Word steps use DOCX=web-tests/fixtures/sample.docx.
//
// A) Desktop Chrome (no phone needed):
//    1. python -m http.server 8765 --bind 127.0.0.1        (run inside app/src/main/assets)
//    2. chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<temp dir> --autoplay-policy=no-user-gesture-required about:blank
//    3. node web-tests/e2e/run.mjs <file.pdf> all
//
// B) The real app on a USB-debugging phone, using the web files from this checkout instead of the installed ones
//    (no rebuild needed; speech goes through the real Android bridge):
//    1. install the app, open it, keep the screen on (adb shell svc power stayon usb)
//    2. adb forward tcp:9222 localabstract:webview_devtools_remote_<pid of the app>
//    3. PORT=9222 URL=https://appassets.androidapp.com/assets/index.html EMULATE=0 INJECT_DIR=app/src/main/assets \
//         node web-tests/e2e/run.mjs <file.pdf> all
//
// steps: smoke | text | tap | zoom | dark | settings | search | docx | all
// env:   PORT, URL, EMULATE, INJECT_DIR, INJECT_WAIT (ms), OUT (screenshot folder),
//        TEXT_PAGES (how many pages the text step reads, default 10), EXPECT_WORDS (comma separated words that must appear),
//        DOCX (path of a .docx for the docx step)

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
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });   // always run the current files
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
await evaluate(`(async () => { for (let i = 0; i < 60 && typeof window.pdfjsLib === 'undefined'; i++) await new Promise((r) => setTimeout(r, 250)); return 1; })()`);   // pdf.js loads lazily
const boot = await evaluate(`JSON.stringify({
  title: document.title,
  pdfjs: typeof window.pdfjsLib,
  voiceOptions: document.getElementById('voice').options.length,
  playIcon: document.getElementById('playBtn').innerHTML.length > 0,
  speedLabel: document.getElementById('speedBtn').textContent,
  zoomLabel: document.getElementById('zoomVal').textContent,
  barH: getComputedStyle(document.documentElement).getPropertyValue('--bar-h'),
  startScreen: document.body.classList.contains('start') && getComputedStyle(document.getElementById('bar')).display === 'none'
})`);
const b = JSON.parse(boot);
const document_start = (info) => info.startScreen === true;
ok('boot: pdf.js loaded', b.pdfjs === 'object', b);
ok('boot: play icon rendered', b.playIcon);
ok('boot: speed label set', /×/.test(b.speedLabel), b.speedLabel);
ok('boot: start screen hides the top bar', parseFloat(b.barH) === 0 && document_start(b), b);

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
const barAfterOpen = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bar-h')`);
ok('open: top bar appears and its height is synced', parseFloat(barAfterOpen) > 0, barAfterOpen);

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
  const leftovers = lines.filter((l) => /[\x00\uFFFD\uE010-\uE014]/.test(l));
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
    // undo through the sheet itself, so the in-memory settings are reset too (a fake key must not stay active)
    document.getElementById('settingsBtn').click(); await new Promise(r => setTimeout(r, 300));
    document.getElementById('apiKey').value = ''; document.getElementById('contMode').value = '1';
    document.getElementById('saveSettings').click(); await new Promise(r => setTimeout(r, 300));
    return JSON.stringify(out); })()`));
  ok('settings: sheet opens, saves, closes; key + continue switch applied', s.opened && s.closedAfterSave && s.dot && s.cont === 'false' && s.keyStored && s.geminiVoices >= 2, s);
}

if (steps.includes('search') || steps.includes('all')) {
  const found = JSON.parse(await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    window.scrollTo(0, 0); await wait(600);
    // a word that really is on the first page: the longest word of the first tappable line
    const line = [...document.querySelectorAll('.line')].find(b => b.title.trim().split(/\s+/).some(w => w.length > 3));
    const word = line.title.trim().split(/\s+/).sort((a, b) => b.length - a.length)[0];
    document.getElementById('searchBtn').click(); await wait(300);
    const input = document.getElementById('searchInput'); input.value = word; input.dispatchEvent(new Event('input'));
    await wait(1500);
    const out = { word, open: !document.getElementById('searchbar').hidden, count: document.getElementById('searchCount').textContent,
      marked: document.querySelectorAll('.line.found').length };
    const box = document.querySelector('.line.found'); if (box) { const r = box.getBoundingClientRect(); out.onScreen = r.top >= 0 && r.bottom <= innerHeight; }
    document.getElementById('searchNext').click(); await wait(600);
    out.afterNext = document.getElementById('searchCount').textContent;
    document.getElementById('searchPrev').click(); await wait(600);
    out.afterPrev = document.getElementById('searchCount').textContent;
    input.value = 'zzqxjkvv'; input.dispatchEvent(new Event('input')); await wait(1200);
    out.none = document.getElementById('searchCount').textContent;
    document.getElementById('searchClose').click(); await wait(200);
    out.closed = document.getElementById('searchbar').hidden; out.markedAfterClose = document.querySelectorAll('.line.found').length;
    return JSON.stringify(out); })()`));
  ok('search: finds a word, marks and shows the hit, steps through hits, reports no match, closes cleanly',
    found.open && /^1 \/ \d+\+?$/.test(found.count) && found.marked === 1 && found.onScreen && /^\d+ \/ \d+/.test(found.afterNext) &&
    found.afterPrev.replace('+', '') === found.count.replace('+', '') &&   // (the + only means the background read is not finished)
     found.none === 'No match' && found.closed && found.markedAfterClose === 0, found);
  await shot('search');
}

if ((steps.includes('docx') || steps.includes('all')) && process.env.DOCX) {
  const docxB64 = fs.readFileSync(process.env.DOCX).toString('base64');
  const opened = JSON.parse(await evaluate(`(async () => {
    const bin = atob('${docxB64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([u], 'sample.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const input = document.getElementById('fileInput'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    for (let i = 0; i < 40 && !document.querySelector('.docx-section'); i++) await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 800));
    const secs = [...document.querySelectorAll('.docx-section')];
    return JSON.stringify({ sections: secs.length, total: document.getElementById('pageTotal').textContent, mode: document.getElementById('pages').classList.contains('docx-mode'),
      heading: (secs[0] && secs[0].querySelector('h1') || {}).textContent, cells: secs[0] ? [...secs[0].querySelectorAll('td')].map(c => c.textContent) : [],
      notice: document.getElementById('notice').textContent, canvases: document.querySelectorAll('.page-wrap canvas').length }); })()`));
  ok('docx: opens as several parts with heading and table', opened.sections >= 2 && String(opened.sections) === opened.total && opened.mode && opened.heading === 'भारतीय राजव्यवस्था (नमूना)' && opened.cells.length === 4 && opened.canvases === 0, opened);

  const spoken = JSON.parse(await evaluate(`(async () => {
    const { state } = await import('/js/core/state.js'); const { forSpeech } = await import('/js/text/speech-text.js');
    const all = state.pages.flatMap((pg) => pg.lines.map((l) => l.text));
    return JSON.stringify({
      numbered: all.filter((t) => /बिंदु:/.test(t)),
      udaharan: all.filter((t) => t.startsWith('उदा')).map(forSpeech),
      example: all.filter((t) => t.startsWith('Ex.')).map(forSpeech),
      loneNumbers: all.filter((t) => /^\s*[0-9]{1,3}[.)]\s*$/.test(t)).length,
      typedNumbers: all.filter((t) => /^[0-9]+\. यह परीक्षण/.test(t)).length }); })()`));
  ok('docx: numbers of an automatically numbered list are spoken ("1. ...", "2. ...")',
    spoken.numbered.length === 3 && spoken.numbered.every((t, i) => t.startsWith((i + 1) + '. ')), spoken);
  ok('docx: abbreviations are spoken in full (उदा: -> उदाहरण:, Ex. -> example)',
    spoken.udaharan[0] && spoken.udaharan[0].startsWith('उदाहरण:') && spoken.example[0] && spoken.example[0].startsWith('example The United States'), spoken);
  ok('docx: a typed number ("1. ...") stays with its sentence instead of being a sentence of its own', spoken.loneNumbers === 0 && spoken.typedNumbers >= 40, spoken);

  const tap = JSON.parse(await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const para = [...document.querySelectorAll('.docx-section p')].find(p => p.textContent.includes('संविधान सर्वोच्च विधि है।'));
    para.scrollIntoView({ block: 'center' }); await wait(500);
    // find the on-screen position of the second sentence and click exactly there
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT); const node = walker.nextNode();
    const start = node.data.indexOf('संविधान'); const range = document.createRange(); range.setStart(node, start + 3); range.setEnd(node, start + 6);
    const r = range.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    await wait(1200);
    const hl = window.CSS && CSS.highlights && CSS.highlights.get('reading');
    const out = { playing: document.getElementById('now').classList.contains('playing'), nowText: document.getElementById('nowText').textContent,
      highlighted: hl ? [...hl].map(rg => rg.toString()) : null, meta: document.getElementById('nowMeta').textContent };
    document.getElementById('playBtn').click(); await wait(400);
    out.pausedPlaying = document.getElementById('now').classList.contains('playing');
    document.getElementById('stopBtn').click(); await wait(300);
    out.afterStop = window.CSS && CSS.highlights ? CSS.highlights.has('reading') : null;
    return JSON.stringify(out); })()`));
  ok('docx: tapping a sentence reads exactly that sentence and highlights it', tap.playing && tap.nowText === 'संविधान सर्वोच्च विधि है।' && JSON.stringify(tap.highlighted) === JSON.stringify(['संविधान सर्वोच्च विधि है।']), tap);
  ok('docx: pause and stop work, highlight removed', tap.pausedPlaying === false && tap.afterStop === false, tap);

  const docxSearch = JSON.parse(await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    document.getElementById('searchBtn').click(); await wait(300);
    const input = document.getElementById('searchInput'); input.value = 'संविधान'; input.dispatchEvent(new Event('input')); await wait(1200);
    const hl = window.CSS && CSS.highlights && CSS.highlights.get('found');
    const out = { count: document.getElementById('searchCount').textContent, highlighted: hl ? [...hl].map(r => r.toString()) : null };
    document.getElementById('searchClose').click(); await wait(200);
    out.cleared = window.CSS && CSS.highlights ? !CSS.highlights.has('found') : null;
    return JSON.stringify(out); })()`));
  ok('docx: search finds sentences and highlights the hit, closing clears it', /^1 \/ \d+/.test(docxSearch.count) && docxSearch.highlighted && docxSearch.highlighted.length === 1 && /संविधान/.test(docxSearch.highlighted[0]) && docxSearch.cleared === true, docxSearch);

  const view = JSON.parse(await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms)); const sec = () => document.querySelector('.docx-section');
    window.scrollTo(0, 0); await wait(300);
    const size0 = parseFloat(getComputedStyle(sec()).fontSize); const scrollW0 = document.documentElement.scrollWidth;
    document.getElementById('zoomIn').click(); document.getElementById('zoomIn').click(); await wait(600);
    const size1 = parseFloat(getComputedStyle(sec()).fontSize); const scrollW1 = document.documentElement.scrollWidth;
    document.getElementById('zoomVal').click(); await wait(400);
    const light = getComputedStyle(sec()).backgroundColor; document.getElementById('darkBtn').click(); await wait(500);
    const dark = getComputedStyle(sec()).backgroundColor; document.getElementById('darkBtn').click(); await wait(300);
    document.getElementById('nextBtn').click(); await wait(1200);
    return JSON.stringify({ size0, size1, scrollW0, scrollW1, light, dark, pageAfterNext: document.getElementById('pageInput').value, zoomLabel: document.getElementById('zoomVal').textContent }); })()`));
  ok('docx: zoom changes the text size without sideways scrolling', view.size1 > view.size0 * 1.4 && view.scrollW1 <= view.scrollW0 + 2, view);
  ok('docx: dark mode darkens the text pages', view.light !== view.dark && /^rgb\((\d+)/.exec(view.dark)[1] < 80, view);
  ok('docx: next page button moves to part 2', view.pageAfterNext === '2', view);

  // a PDF must still open afterwards (switching document kinds)
  const back = JSON.parse(await evaluate(`(async () => {
    const bin = atob('${b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'test.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('fileInput'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 5000));
    return JSON.stringify({ pdfPages: document.querySelectorAll('.page-wrap').length, docxLeft: document.querySelectorAll('.docx-section').length, mode: document.getElementById('pages').classList.contains('docx-mode') }); })()`));
  ok('docx: opening a PDF afterwards works', back.pdfPages > 1 && back.docxLeft === 0 && back.mode === false, back);
}

ok('no uncaught exceptions', exceptions.length === 0, exceptions);
const relevantErrors = consoleErrors.filter((e) => !/favicon|fonts.googleapis|ERR_BLOCKED|speech|generativelanguage\.googleapis/i.test(e));   // generativelanguage: the settings step saves a fake key on purpose
ok('no console errors', relevantErrors.length === 0, relevantErrors);

console.log(JSON.stringify(report, null, 1));
const failed = Object.values(report).filter((v) => v.startsWith('FAIL')).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
ws.close();
process.exit(failed ? 1 : 0);
