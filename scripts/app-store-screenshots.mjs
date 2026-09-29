import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const outputDirectory = fileURLToPath(
  new URL("../apps/mobile/app-store/screenshots/tr-TR/iphone-6.5/", import.meta.url),
);

await mkdir(outputDirectory, { recursive: true });

const target = await fetch(
  `${endpoint}/json/new?${encodeURIComponent("http://localhost:5080")}`,
  { method: "PUT" },
).then((response) => response.json());

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;

  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function evaluate(expression) {
  return command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
}

async function capture(fileName) {
  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(
    `${outputDirectory}${fileName}`,
    Buffer.from(screenshot.data, "base64"),
  );
}

await command("Page.enable");
await command("Runtime.enable");
await command("Emulation.setDeviceMetricsOverride", {
  width: 428,
  height: 926,
  deviceScaleFactor: 3,
  mobile: true,
  screenWidth: 428,
  screenHeight: 926,
});
await command("Page.reload", { ignoreCache: true });
await wait(1800);

await capture("01-starter-core.png");

await evaluate(`document.querySelector('[data-view="store"]').click()`);
await wait(500);
await capture("02-kozmetik-magaza.png");

await evaluate(`(async () => {
  const response = await fetch('/api/v1/auth/guest', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({deviceId: 'app-store-' + Date.now(), nickname: 'Nova'})
  });
  const session = await response.json();
  sessionStorage.setItem('swarm.accessToken', session.accessToken);
  sessionStorage.setItem('swarm.playerId', session.player.id);
  location.href = '/game.html';
})()`);
await wait(900);
await capture("03-canli-arena.png");

console.log(JSON.stringify({
  outputDirectory,
  screenshots: [
    "01-starter-core.png",
    "02-kozmetik-magaza.png",
    "03-canli-arena.png",
  ],
  size: "1284x2778",
}));

socket.close();
