import { writeFile } from 'node:fs/promises';

const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent('http://localhost:5080')}`, { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return;
  const promise = pending.get(message.id); pending.delete(message.id); message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result);
});
function command(method, params = {}) { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function evaluate(expression) { return command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); }
async function inspect(width, height, mobile, fileName) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await command('Page.reload', { ignoreCache: true }); await wait(1800);
  const homeShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../home-${fileName}`, import.meta.url), Buffer.from(homeShot.data, 'base64'));
  await evaluate(`document.querySelector('[data-view="store"]').click()`); await wait(500);
  const state = await evaluate(`({
    width: innerWidth, height: innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    cards: document.querySelectorAll('.skin-card').length,
    columns: getComputedStyle(document.querySelector('#catalog-grid')).gridTemplateColumns.split(' ').length,
    previewVisible: document.querySelector('#character-preview').getBoundingClientRect().height > 100,
    panelOpen: !document.querySelector('#cosmetics').hidden
  })`);
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../${fileName}`, import.meta.url), Buffer.from(shot.data, 'base64'));
  return state.result.value;
}
await command('Page.enable'); await command('Runtime.enable');
const desktop = await inspect(1440, 900, false, 'lobby-desktop-qa.png');
const mobile = await inspect(390, 844, true, 'lobby-mobile-qa.png');
console.log(JSON.stringify({ desktop, mobile }));
socket.close();
