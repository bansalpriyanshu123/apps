// Opens a PDF in the app (desktop Chrome from web-tests/e2e/run.mjs, steps A) and prints the lines the app built for
// the given pages: x, y, width and text. For checking reading order and line splitting on a real document.
//   node web-tests/tools/dump-lines.mjs <file.pdf> 8 95
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 9333);
const [pdfPath, ...pages] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: process.env.URL || 'http://127.0.0.1:8765/index.html' });
await wait(3500);
const b64 = fs.readFileSync(pdfPath).toString('base64');
await evaluate(`(async () => {
  const bin = atob('${b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], 'doc.pdf', { type: 'application/pdf' }));
  const input = document.getElementById('fileInput'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 5000)); })()`);
for (const n of pages) {
  const out = await evaluate(`(async () => {
    const input = document.getElementById('pageInput'); input.value = ${n}; input.dispatchEvent(new Event('change'));
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400));
      const w = document.querySelectorAll('.page-wrap')[${n} - 1]; if (w && w.querySelectorAll('.line').length) break; }
    const w = document.querySelectorAll('.page-wrap')[${n} - 1];
    return [...w.querySelectorAll('.line')].map((b, i) => i + ' x=' + Math.round(parseFloat(b.style.left)) + ' y=' + Math.round(parseFloat(b.style.top)) + ' w=' + Math.round(parseFloat(b.style.width)) + ' | ' + b.title).join(' ## '); })()`);
  console.log('=== page ' + n + ' ===\n' + out);
}
process.exit(0);
