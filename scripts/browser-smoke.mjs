import { writeFile } from "node:fs/promises";

const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent("http://localhost:5080")}`, { method: "PUT" }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
await command("Page.enable");
await command("Runtime.enable");
await wait(1000);
await command("Runtime.evaluate", {
  awaitPromise: true,
  expression: `(async () => {
    const deviceId = 'browser-smoke-' + Date.now();
    const response = await fetch('/api/v1/auth/guest', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({deviceId, nickname:'SmokeNova'})
    });
    const session = await response.json();
    sessionStorage.setItem('swarm.accessToken', session.accessToken);
    sessionStorage.setItem('swarm.playerId', session.player.id);
    location.href = '/game.html';
  })()`
});
await wait(3500);

const beforeMove = await command("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => { const id=sessionStorage.getItem('swarm.playerId'); const p=snapshot.players.find(x=>x.id.toLowerCase()===id.toLowerCase()); return {x:p.position.x,y:p.position.y,arenaWidth:snapshot.arenaWidth}; })()`
});
const moveDirection = beforeMove.result.value.x > beforeMove.result.value.arenaWidth / 2 ? -1 : 1;
await command("Runtime.evaluate", { expression: `input={x:${moveDirection},y:0};sendInput();` });
await wait(700);
const afterMove = await command("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => { const id=sessionStorage.getItem('swarm.playerId'); const p=snapshot.players.find(x=>x.id.toLowerCase()===id.toLowerCase()); return {x:p.position.x,y:p.position.y}; })()`
});
await command("Runtime.evaluate", { expression: `input={x:0,y:0};sendInput();` });

const state = await command("Runtime.evaluate", {
  returnByValue: true,
  expression: `JSON.stringify({
    title: document.title,
    connection: document.querySelector('#connection')?.textContent,
    score: document.querySelector('#score')?.textContent,
    leaderboardRows: document.querySelectorAll('#leaderboard li').length,
    canvasWidth: document.querySelector('#arena')?.width,
    canvasHeight: document.querySelector('#arena')?.height,
    gameOverHidden: document.querySelector('#game-over')?.hidden
  })`
});
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(new URL("../game-qa.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
const report = JSON.parse(state.result.value);
report.startPosition = beforeMove.result.value;
report.endPosition = afterMove.result.value;
report.movedPixels = Math.round(Math.abs(afterMove.result.value.x - beforeMove.result.value.x) * 10) / 10;
report.movementPassed = report.movedPixels > 40;
console.log(JSON.stringify(report));
socket.close();
