const canvas = document.querySelector('#arena');
const context = canvas.getContext('2d');
const connectionNode = document.querySelector('#connection');
const scoreNode = document.querySelector('#score');
const leaderboardNode = document.querySelector('#leaderboard ol');
const gameOverNode = document.querySelector('#game-over');
const eventNode = document.querySelector('#event-banner');
const playerId = sessionStorage.getItem('swarm.playerId');
const accessToken = sessionStorage.getItem('swarm.accessToken');
let snapshot = { players: [], energy: [], zones: [], arenaWidth: 3200, arenaHeight: 1800 };
let socket;
let input = { x: 0, y: 0 };
let reconnectTimer;
let lastOwnPlayer;
const trails = new Map();
const visualRadii = new Map();

function resize() {
  canvas.width = Math.floor(innerWidth * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
}
addEventListener('resize', resize);
resize();

async function connect() {
  clearTimeout(reconnectTimer);
  if (!accessToken || !playerId) return location.replace(window.SwarmRuntime.homeUrl);
  connectionNode.textContent = 'EŞLEŞİYOR';
  let response;
  try { response = await fetch(window.SwarmRuntime.apiUrl('/api/v1/matchmaking/queue'), { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } }); }
  catch { connectionNode.textContent = 'SUNUCU BEKLENİYOR'; reconnectTimer = setTimeout(connect, 1800); return; }
  if (response.status === 401) return location.replace(window.SwarmRuntime.homeUrl);
  if (!response.ok) { connectionNode.textContent = 'TEKRAR DENENİYOR'; reconnectTimer = setTimeout(connect, 1800); return; }
  const assignment = await response.json();
  socket = new WebSocket(`${assignment.websocketUrl}?ticket=${encodeURIComponent(assignment.ticket)}`);
  socket.addEventListener('open', () => { connectionNode.textContent = 'CANLI'; sendInput(); });
  socket.addEventListener('close', () => { connectionNode.textContent = 'YENİDEN BAĞLANIYOR'; reconnectTimer = setTimeout(connect, 1200); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') { snapshot = message; updateHud(); }
    if (message.type === 'gameOver') claimReward(message);
  });
}

function sendInput(dash = false, ability = null) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...input, dash, ability }));
}

function pointInput(clientX, clientY) {
  input = { x: clientX - innerWidth / 2, y: clientY - innerHeight / 2 };
  sendInput();
}
addEventListener('pointermove', event => pointInput(event.clientX, event.clientY));
addEventListener('pointerdown', event => pointInput(event.clientX, event.clientY));
const keys = new Set();
const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  keys.add(key);
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) activateDash(); }
  if (key === 'q' && !event.repeat) activateAbility('shield', 15);
  if (key === 'e' && !event.repeat) activateAbility('magnet', 13);
  if (movementKeys.has(key)) keyboardInput();
});
addEventListener('keyup', event => {
  const key = event.key.toLowerCase();
  keys.delete(key);
  if (movementKeys.has(key)) keyboardInput();
});
function keyboardInput() {
  input = {
    x: (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0),
    y: (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0)
  };
  sendInput();
}

function updateHud() {
  const players = (snapshot.players ?? []).slice().sort((a, b) => b.score - a.score);
  const own = players.find(player => player.id.toLowerCase() === playerId.toLowerCase());
  if (own) {
    lastOwnPlayer = own;
    scoreNode.textContent = own.score.toLocaleString('tr-TR');
    document.querySelector('#rank').textContent = `#${players.findIndex(player => player.id === own.id) + 1}`;
    document.querySelector('#size').textContent = `${Math.max(1, own.radius / 18).toFixed(1)}×`;
    if (!own.alive && gameOverNode.hidden) showGameOver(players, own);
  }
  eventNode.hidden = !snapshot.event;
  eventNode.textContent = snapshot.event?.message ?? '';
  leaderboardNode.innerHTML = players.slice(0, 5).map((player, index) => `<li class="${player.id.toLowerCase() === playerId.toLowerCase() ? 'you' : ''}"><b>${index + 1}</b><span>${escapeHtml(player.nickname)}</span><strong>${player.score}</strong></li>`).join('');
}

function showGameOver(players, own) {
  document.querySelector('#final-rank').textContent = `#${players.findIndex(player => player.id === own.id) + 1}`;
  document.querySelector('#final-score').textContent = own.score;
  document.querySelector('#final-kills').textContent = own.kills;
  gameOverNode.hidden = false;
}
async function claimReward(message) {
  try {
    const response = await fetch(window.SwarmRuntime.apiUrl('/api/v1/rewards/match'), {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ resultToken: message.resultToken })
    });
    const reward = await response.json();
    document.querySelector('#final-coins').textContent = response.ok ? `+${reward.coins}` : '+0';
  } catch { document.querySelector('#final-coins').textContent = '+0'; }
}
document.querySelector('#play-again').addEventListener('click', () => location.reload());
document.querySelector('#dash').addEventListener('click', activateDash);
document.querySelector('#shield').addEventListener('click', () => activateAbility('shield', 15));
document.querySelector('#magnet').addEventListener('click', () => activateAbility('magnet', 13));
document.querySelectorAll('.ability-bar button').forEach(button => button.addEventListener('pointerdown', event => event.stopPropagation()));
function activateDash() {
  const button = document.querySelector('#dash');
  if (button.disabled) return;
  sendInput(true);
  button.disabled = true;
  button.classList.add('pressed');
  let remaining = 4;
  button.querySelector('span').textContent = `${remaining} SN`;
  const timer = setInterval(() => {
    remaining--;
    if (remaining > 0) button.querySelector('span').textContent = `${remaining} SN`;
    else { clearInterval(timer); button.disabled = false; button.classList.remove('pressed'); button.querySelector('span').textContent = 'SPACE'; }
  }, 1000);
}

function activateAbility(name, cooldown) {
  const button = document.querySelector(`#${name}`);
  if (button.disabled) return;
  sendInput(false, name);
  runCooldown(button, cooldown, name === 'shield' ? 'Q' : 'E');
}

function runCooldown(button, seconds, readyLabel) {
  button.disabled = true;
  button.classList.add('pressed');
  let remaining = seconds;
  button.querySelector('span').textContent = `${remaining} SN`;
  const timer = setInterval(() => {
    remaining--;
    if (remaining > 0) button.querySelector('span').textContent = `${remaining} SN`;
    else { clearInterval(timer); button.disabled = false; button.classList.remove('pressed'); button.querySelector('span').textContent = readyLabel; }
  }, 1000);
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function render() {
  const dpr = devicePixelRatio;
  const own = (snapshot.players ?? []).find(player => player.id.toLowerCase() === playerId?.toLowerCase()) ?? lastOwnPlayer;
  const camera = own?.position ?? { x: 800, y: 450 };
  const zoom = dpr * Math.max(0.72, 1.08 - ((own?.radius ?? 18) - 18) * 0.006);
  const screen = position => ({ x: canvas.width / 2 + (position.x - camera.x) * zoom, y: canvas.height / 2 + (position.y - camera.y) * zoom });

  context.fillStyle = '#030611';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawNebula(camera, zoom);
  drawGrid(camera, zoom);
  drawBoundary(screen, zoom);
  drawZones(screen, zoom);

  for (const orb of snapshot.energy ?? []) {
    const point = screen(orb.position);
    if (point.x < -20 || point.y < -20 || point.x > canvas.width + 20 || point.y > canvas.height + 20) continue;
    const radius = ({ rare: 5.5, epic: 7.5, core: 10 }[orb.kind] ?? 3.5) * zoom;
    context.beginPath();
    context.fillStyle = ({ rare: '#64ff8d', epic: '#c49cff', core: '#f5c96c' }[orb.kind] ?? '#59e4ed');
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 14 * dpr;
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;

  for (const player of snapshot.players ?? []) {
    if (!player.alive) continue;
    const trail = trails.get(player.id) ?? [];
    trail.unshift({ ...player.position });
    if (trail.length > 20) trail.pop();
    trails.set(player.id, trail);
    drawCreature(player, trail, screen, zoom, player.id.toLowerCase() === playerId?.toLowerCase());
  }
  requestAnimationFrame(render);
}

function drawCreature(player, trail, screen, zoom, own) {
  const skin = window.SwarmCharacters?.skins[player.skinId] ?? window.SwarmCharacters?.skins.starter;
  const color = skin?.primary ?? (own ? '#59e4ed' : '#b69cff');
  const previousRadius = visualRadii.get(player.id) ?? player.radius;
  const visualRadius = previousRadius + (player.radius - previousRadius) * .16;
  visualRadii.set(player.id, visualRadius);
  for (let index = trail.length - 1; index >= 3; index -= 3) {
    const point = screen(trail[index]);
    const fade = 1 - index / trail.length;
    context.beginPath(); context.globalAlpha = fade * 0.34; context.fillStyle = color;
    context.arc(point.x, point.y, Math.max(1.5 * devicePixelRatio, visualRadius * zoom * fade * .12), 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;
  const point = screen(player.position);
  if (player.magnetActive) {
    context.beginPath(); context.strokeStyle = '#c49cff66'; context.lineWidth = 2 * devicePixelRatio;
    context.arc(point.x, point.y, 120 * zoom, 0, Math.PI * 2); context.stroke();
  }
  window.SwarmCharacters?.drawCharacter(context, { x: point.x, y: point.y, radius: visualRadius * zoom, skinId: player.skinId, time: performance.now() });
  if (player.shieldActive) {
    context.beginPath(); context.strokeStyle = '#73c5ff'; context.lineWidth = 3 * devicePixelRatio; context.shadowColor = '#73c5ff'; context.shadowBlur = 16 * devicePixelRatio;
    context.arc(point.x, point.y, visualRadius * zoom * 1.35, 0, Math.PI * 2); context.stroke(); context.shadowBlur = 0;
  }
  const leaderScore = Math.max(...(snapshot.players ?? []).filter(candidate => candidate.alive).map(candidate => candidate.score), 0);
  if (player.score === leaderScore && player.score >= 120) {
    context.beginPath(); context.strokeStyle = '#ff4d8d99'; context.lineWidth = 2 * devicePixelRatio;
    context.arc(point.x, point.y, visualRadius * zoom * 1.55, 0, Math.PI * 2); context.stroke();
  }
  context.fillStyle = '#fff'; context.font = `700 ${12 * devicePixelRatio}px system-ui`; context.textAlign = 'center';
  context.shadowColor = '#02040b'; context.shadowBlur = 6 * devicePixelRatio;
  context.fillText(player.nickname, point.x, point.y - visualRadius * zoom * 1.55 - 8 * devicePixelRatio);
  context.shadowBlur = 0;
}

function drawZones(screen, zoom) {
  const styles = {
    speed: ['#59e4ed18', '#59e4ed88', 'HIZ BÖLGESİ'],
    gold: ['#f5c96c18', '#f5c96c88', '2X ENERJİ'],
    gravity: ['#b69cff14', '#b69cff66', 'ÇEKİM MERKEZİ']
  };
  for (const zone of snapshot.zones ?? []) {
    const point = screen(zone.position), style = styles[zone.kind] ?? styles.gravity;
    context.beginPath(); context.fillStyle = style[0]; context.strokeStyle = style[1]; context.lineWidth = 2 * devicePixelRatio;
    context.arc(point.x, point.y, zone.radius * zoom, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = style[1]; context.font = `800 ${10 * devicePixelRatio}px system-ui`; context.textAlign = 'center';
    context.fillText(style[2], point.x, point.y - zone.radius * zoom + 18 * devicePixelRatio);
  }
}

function drawGrid(camera, zoom) {
  context.strokeStyle = '#111a40'; context.lineWidth = devicePixelRatio;
  const step = 100 * zoom, startX = canvas.width / 2 - (camera.x * zoom) % step, startY = canvas.height / 2 - (camera.y * zoom) % step;
  for (let x = startX; x < canvas.width; x += step) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
  for (let y = startY; y < canvas.height; y += step) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
}

function drawNebula(camera, zoom) {
  const glow = context.createRadialGradient(canvas.width * .72, canvas.height * .28, 0, canvas.width * .72, canvas.height * .28, canvas.width * .55);
  glow.addColorStop(0, '#28135f55'); glow.addColorStop(.5, '#101c4b33'); glow.addColorStop(1, '#03061100'); context.fillStyle = glow; context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawBoundary(screen, zoom) {
  const topLeft = screen({ x: 0, y: 0 });
  context.strokeStyle = '#ff4d8d'; context.lineWidth = 4 * devicePixelRatio; context.shadowColor = '#ff4d8d'; context.shadowBlur = 20;
  context.strokeRect(topLeft.x, topLeft.y, snapshot.arenaWidth * zoom, snapshot.arenaHeight * zoom); context.shadowBlur = 0;
}

connect().catch(() => { connectionNode.textContent = 'SUNUCU YOK'; reconnectTimer = setTimeout(connect, 1500); });
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
