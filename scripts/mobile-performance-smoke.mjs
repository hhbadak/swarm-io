const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9246';
const appUrl = process.env.TEST_URL ?? 'http://127.0.0.1:5098/index.html?offline=1';
const target = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json());
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
async function value(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await command('Page.enable');
await command('Runtime.enable');
await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await command('Page.navigate', { url: appUrl });
for (let attempt = 0; attempt < 40; attempt++) {
  await wait(200);
  const ready = await value(`document.readyState === 'complete' && Boolean(window.SwarmOffline?.request)`).catch(() => false);
  if (ready) break;
  if (attempt === 39) throw new Error('Offline home screen did not become ready.');
}
await value(`(async () => {
  const response = await window.SwarmOffline.request('/api/v1/auth/guest', {
    method: 'POST', body: JSON.stringify({nickname:'PerfNova'})
  });
  const session = await response.json();
  window.SwarmRuntime.session.set('swarm.accessToken', session.accessToken);
  window.SwarmRuntime.session.set('swarm.playerId', session.player.id);
  location.href = window.SwarmRuntime.page('./game.html');
  return true;
})()`);

for (let attempt = 0; attempt < 30; attempt++) {
  await wait(200);
  if (await value(`document.querySelector('#connection')?.textContent === 'CİHAZ İÇİ TEST'`).catch(() => false)) break;
  if (attempt === 29) throw new Error('Offline arena did not become ready.');
}

await value(`(() => {
  const template = snapshot.players.find(player => player.isBot);
  while (snapshot.players.length < 50) {
    const index = snapshot.players.length;
    snapshot.players.push({ ...template, id:'perf-bot-' + index, nickname:'Bot-' + index,
      position:{x:120 + (index * 197) % 2960,y:100 + (index * 113) % 1600},
      angle:(index % 12) / 12 * Math.PI * 2, turnAt:performance.now() + 10000, alive:true });
  }
  return snapshot.players.length;
})()`);

// Let image decoding, font rasterization and the first full 50-player paint settle.
// The measurement below is for sustained gameplay, not application startup.
await wait(2000);

const metrics = await value(`new Promise(resolve => {
  const intervals=[]; const fpsLabels=[]; let previous=performance.now(); const started=previous;
  const poll=setInterval(()=>fpsLabels.push(parseInt(document.querySelector('#fps')?.textContent)||0),250);
  function sample(now) {
    intervals.push(now-previous); previous=now;
    if (now-started < 5000) return requestAnimationFrame(sample);
    clearInterval(poll);
    intervals.shift(); intervals.sort((a,b)=>a-b);
    const duration=now-started;
    resolve({
      samples:intervals.length,
      averageFps:Math.round(intervals.length*100000/duration)/100,
      displayedFps:Math.min(...fpsLabels.filter(Boolean)),
      p95FrameMs:Math.round(intervals[Math.floor(intervals.length*.95)]*100)/100,
      maxFrameMs:Math.round(intervals.at(-1)*100)/100,
      longFrames:intervals.filter(value=>value>34).length,
      players:snapshot.players.length,
      energy:snapshot.energy.length,
      renderQuality,
      renderDpr
    });
  }
  requestAnimationFrame(sample);
})`);

metrics.passed = metrics.samples >= 200 && metrics.averageFps >= 55 && metrics.displayedFps >= 50 && metrics.p95FrameMs < 25 && metrics.longFrames <= 3;
console.log(JSON.stringify(metrics));
socket.close();
await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
if (!metrics.passed) process.exitCode = 1;
