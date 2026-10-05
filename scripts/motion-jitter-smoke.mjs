const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9244';
const appOrigin = process.env.SWARM_APP_ORIGIN ?? 'https://swarm-io-hhbadak-live.onrender.com';
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(appOrigin)}`, { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const callbacks = pending.get(message.id);
  pending.delete(message.id);
  message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
});
function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function value(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}

await command('Page.enable');
await command('Runtime.enable');
await command('Network.enable');
await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await wait(1200);
await value(`(async () => {
  const response = await fetch('/api/v1/auth/guest', {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({deviceId:'jitter-smoke-' + Date.now(), nickname:'JitterNova'})
  });
  const session = await response.json();
  sessionStorage.setItem('swarm.accessToken', session.accessToken);
  sessionStorage.setItem('swarm.playerId', session.player.id);
  location.href = '/game.html';
  return true;
})()`);

for (let attempt = 0; attempt < 30; attempt++) {
  await wait(300);
  if (await value(`document.querySelector('#connection')?.textContent?.startsWith('CANLI') === true && typeof snapshot !== 'undefined' && Array.isArray(snapshot?.players) && snapshot.players.length > 0`).catch(() => false)) break;
  if (attempt === 29) throw new Error('Arena connection did not become ready.');
}

const direction = await value(`(() => {
  const id=sessionStorage.getItem('swarm.playerId');
  const own=snapshot.players.find(player=>player.id.toLowerCase()===id.toLowerCase());
  return own.position.x > snapshot.arenaWidth / 2 ? -1 : 1;
})()`);
await value(`(() => {
  window.__motionSamples=[];
  window.__sampleMotion=true;
  const collect=now=>{
    if (!window.__sampleMotion) return;
    if (localPredictedPosition) window.__motionSamples.push({t:now,x:localPredictedPosition.x,y:localPredictedPosition.y});
    requestAnimationFrame(collect);
  };
  input={x:${direction},y:0}; sendInput(true); requestAnimationFrame(collect);
  return true;
})()`);

for (const latency of [40, 240, 70, 320, 110, 260, 50, 190, 80, 280]) {
  await command('Network.emulateNetworkConditions', {
    offline: false, latency, downloadThroughput: 1_500_000, uploadThroughput: 750_000, connectionType: 'cellular3g'
  });
  await wait(400);
}
await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'none' });
const samples = await value(`window.__sampleMotion=false; input={x:0,y:0}; sendInput(); window.__motionSamples`);

const steps = samples.slice(1).map((sample, index) => (sample.x - samples[index].x) * direction);
const sorted = steps.map(Math.abs).sort((a, b) => a - b);
const report = {
  passed: samples.length >= 100 && Math.max(...sorted) < 14 && steps.filter(step => step < -1).length === 0,
  samples: samples.length,
  distance: Math.round(Math.abs(samples.at(-1).x - samples[0].x) * 10) / 10,
  maxFrameStep: Math.round(Math.max(...sorted) * 100) / 100,
  p95FrameStep: Math.round(sorted[Math.floor(sorted.length * .95)] * 100) / 100,
  backwardFrames: steps.filter(step => step < -1).length,
  interpolationDelayMs: await value('Math.round(interpolationDelayMs)')
};
console.log(JSON.stringify(report));
socket.close();
await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
if (!report.passed) process.exitCode = 1;
