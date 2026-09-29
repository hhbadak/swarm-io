const canvas = document.querySelector('#arena');
const context = canvas.getContext('2d');
const connectionNode = document.querySelector('#connection');
const scoreNode = document.querySelector('#score');
const leaderboardNode = document.querySelector('#leaderboard ol');
const gameOverNode = document.querySelector('#game-over');
const eventNode = document.querySelector('#event-banner');
const playerId = window.SwarmRuntime.session.get('swarm.playerId');
const accessToken = window.SwarmRuntime.session.get('swarm.accessToken');
let snapshot = { players: [], energy: [], zones: [], arenaWidth: 3200, arenaHeight: 1800 };
let socket;
let input = { x: 0, y: 0 };
let reconnectTimer;
let lastOwnPlayer;
let localMode = false;
let localDashUntil = 0;
let localArenaTimer;
let boundaryPenaltyReadyAt = 0;
let boundaryWarningUntil = 0;
const trails = new Map();
const visualRadii = new Map();
const BASE_RADIUS = 22;

function radiusForScore(score) { return BASE_RADIUS + Math.sqrt(Math.max(0, score)) * 1.22; }
function insideZone(position, kind) {
  const zone = snapshot.zones?.find(candidate => candidate.kind === kind);
  return Boolean(zone && Math.hypot(position.x - zone.position.x, position.y - zone.position.y) <= zone.radius);
}

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
  try { response = await window.SwarmRuntime.request('/api/v1/matchmaking/queue', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } }); }
  catch { connectionNode.textContent = 'SUNUCU BEKLENİYOR'; reconnectTimer = setTimeout(connect, 1800); return; }
  if (response.status === 401) return location.replace(window.SwarmRuntime.homeUrl);
  if (!response.ok) { connectionNode.textContent = 'TEKRAR DENENİYOR'; reconnectTimer = setTimeout(connect, 1800); return; }
  const assignment = await response.json();
  if (assignment.offline) { startLocalArena(); return; }
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
  if (localMode) {
    const own = snapshot.players.find(player => player.id === playerId);
    if (dash) localDashUntil = performance.now() + 360;
    if (own && ability === 'shield') own.shieldUntil = performance.now() + 3000;
    if (own && ability === 'magnet') own.magnetUntil = performance.now() + 5000;
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...input, dash, ability }));
}

function startLocalArena() {
  if (localMode) return;
  localMode = true;
  connectionNode.textContent = 'CİHAZ İÇİ TEST';
  const state = window.SwarmOffline?.read?.() ?? { nickname: 'Nova', equippedSkin: 'starter' };
  const skins = ['starter', 'neon', 'hex', 'solar', 'void', 'gold'];
  const names = ['Orion', 'Vega', 'Lyra', 'Atlas', 'Luna', 'Pulsar', 'Astra', 'Comet'];
  const own = { id: playerId, nickname: state.nickname, skinId: state.equippedSkin, position: { x: 1600, y: 900 }, radius: BASE_RADIUS, score: 0, kills: 0, alive: true };
  const bots = names.map((nickname, index) => ({
    id: `offline-bot-${index}`, nickname, skinId: skins[(index + 1) % skins.length],
    position: { x: 250 + Math.random() * 2700, y: 180 + Math.random() * 1440 },
    radius: 18 + Math.random() * 12, score: Math.floor(Math.random() * 80), kills: 0, alive: true,
    angle: Math.random() * Math.PI * 2, turnAt: 0
  }));
  snapshot = {
    players: [own, ...bots], arenaWidth: 3200, arenaHeight: 1800,
    zones: [
      { kind: 'speed', position: { x: 700, y: 450 }, radius: 210 },
      { kind: 'gold', position: { x: 2500, y: 1250 }, radius: 230 },
      { kind: 'gravity', position: { x: 1650, y: 920 }, radius: 180 }
    ],
    energy: Array.from({ length: 260 }, (_, index) => offlineOrb(index))
  };
  let previous = performance.now();
  localArenaTimer = setInterval(() => {
    const now = performance.now(), dt = Math.min(.05, (now - previous) / 1000); previous = now;
    updateLocalArena(dt, now);
  }, 32);
}

function offlineOrb(index = 0) {
  const roll = Math.random();
  return { id: `orb-${index}-${Math.random()}`, kind: roll > .985 ? 'core' : roll > .93 ? 'epic' : roll > .78 ? 'rare' : 'common', position: { x: 35 + Math.random() * 3130, y: 35 + Math.random() * 1730 } };
}

function updateLocalArena(dt, now) {
  const own = snapshot.players.find(player => player.id === playerId);
  if (!own?.alive) return;
  const magnitude = Math.hypot(input.x, input.y) || 1;
  const moving = Math.hypot(input.x, input.y) > 0;
  let speed = (now < localDashUntil ? 620 : 245) / Math.max(1, own.radius / 24);
  if (insideZone(own.position, 'speed')) speed *= 1.35;
  let nextX = own.position.x;
  let nextY = own.position.y;
  if (moving) {
    nextX += input.x / magnitude * speed * dt;
    nextY += input.y / magnitude * speed * dt;
  }
  const gravityZone = snapshot.zones.find(zone => zone.kind === 'gravity');
  if (gravityZone && insideZone(own.position, 'gravity')) {
    const dx = gravityZone.position.x - own.position.x, dy = gravityZone.position.y - own.position.y;
    const pullLength = Math.hypot(dx, dy) || 1;
    nextX += dx / pullLength * 72 * dt;
    nextY += dy / pullLength * 72 * dt;
  }
  const hitBoundary = nextX <= own.radius || nextX >= snapshot.arenaWidth - own.radius || nextY <= own.radius || nextY >= snapshot.arenaHeight - own.radius;
  own.position.x = Math.max(own.radius, Math.min(snapshot.arenaWidth - own.radius, nextX));
  own.position.y = Math.max(own.radius, Math.min(snapshot.arenaHeight - own.radius, nextY));
  if (hitBoundary && now >= boundaryPenaltyReadyAt) {
    const penalty = Math.min(own.score, Math.max(4, Math.ceil(own.score * .04)));
    own.score -= penalty;
    own.radius = radiusForScore(own.score);
    boundaryPenaltyReadyAt = now + 700;
    boundaryWarningUntil = now + 900;
  }
  own.shieldActive = now < (own.shieldUntil || 0);
  own.magnetActive = now < (own.magnetUntil || 0);

  for (const bot of snapshot.players.filter(player => player.id !== playerId && player.alive)) {
    if (now > bot.turnAt) { bot.angle += (Math.random() - .5) * 1.7; bot.turnAt = now + 700 + Math.random() * 1700; }
    const botSpeed = 105 / Math.max(1, bot.radius / 24);
    bot.position.x += Math.cos(bot.angle) * botSpeed * dt; bot.position.y += Math.sin(bot.angle) * botSpeed * dt;
    if (bot.position.x < bot.radius || bot.position.x > snapshot.arenaWidth - bot.radius) { bot.angle = Math.PI - bot.angle; bot.position.x = Math.max(bot.radius, Math.min(snapshot.arenaWidth - bot.radius, bot.position.x)); }
    if (bot.position.y < bot.radius || bot.position.y > snapshot.arenaHeight - bot.radius) { bot.angle = -bot.angle; bot.position.y = Math.max(bot.radius, Math.min(snapshot.arenaHeight - bot.radius, bot.position.y)); }
  }

  for (const player of snapshot.players.filter(candidate => candidate.alive)) {
    for (let index = snapshot.energy.length - 1; index >= 0; index--) {
      const orb = snapshot.energy[index];
      const reach = player.radius + (player.magnetActive ? 105 : orb.kind === 'core' ? 12 : 7);
      if (Math.hypot(player.position.x - orb.position.x, player.position.y - orb.position.y) > reach) continue;
      const baseValue = ({ common: 2, rare: 5, epic: 10, core: 24 })[orb.kind] || 2;
      const value = insideZone(player.position, 'gold') ? baseValue * 2 : baseValue;
      player.score += value; player.radius = radiusForScore(player.score);
      snapshot.energy[index] = offlineOrb(index);
    }
  }

  const alive = snapshot.players.filter(player => player.alive);
  for (let left = 0; left < alive.length; left++) for (let right = left + 1; right < alive.length; right++) {
    const a = alive[left], b = alive[right], distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const larger = a.radius >= b.radius ? a : b, smaller = larger === a ? b : a;
    if (distance > larger.radius || larger.radius < smaller.radius * 1.025 || smaller.shieldActive) continue;
    smaller.alive = false; larger.kills += 1; larger.score += Math.max(20, Math.round(smaller.score * .7)); larger.radius = radiusForScore(larger.score);
    if (smaller.id === playerId) {
      clearInterval(localArenaTimer);
      updateHud();
      showGameOver(snapshot.players.slice().sort((x, y) => y.score - x.score), smaller);
      claimReward({ offline: true, score: smaller.score, kills: smaller.kills });
    }
  }
  updateHud();
}

function pointInput(clientX, clientY) {
  input = { x: clientX - innerWidth / 2, y: clientY - innerHeight / 2 };
  sendInput();
}
let arenaPointerId = null;
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch') return;
  arenaPointerId = event.pointerId;
  pointInput(event.clientX, event.clientY);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'mouse' || event.pointerId === arenaPointerId) pointInput(event.clientX, event.clientY);
});
canvas.addEventListener('pointerup', event => { if (event.pointerId === arenaPointerId) arenaPointerId = null; });

const stick = document.querySelector('.mobile-stick');
let stickPointerId = null;
function moveStick(event) {
  const rect = stick.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
  const limit = rect.width * .32, length = Math.hypot(dx, dy) || 1, scale = Math.min(1, limit / length);
  const x = dx * scale, y = dy * scale;
  stick.style.setProperty('--stick-x', `${x}px`); stick.style.setProperty('--stick-y', `${y}px`);
  input = { x: x / limit, y: y / limit };
  sendInput();
}
function releaseStick(event) {
  if (event.pointerId !== stickPointerId) return;
  stickPointerId = null; input = { x: 0, y: 0 };
  stick.style.setProperty('--stick-x', '0px'); stick.style.setProperty('--stick-y', '0px');
  sendInput();
}
stick.addEventListener('pointerdown', event => {
  event.preventDefault(); event.stopPropagation(); stickPointerId = event.pointerId; stick.setPointerCapture(event.pointerId); moveStick(event);
});
stick.addEventListener('pointermove', event => { if (event.pointerId === stickPointerId) { event.preventDefault(); moveStick(event); } });
stick.addEventListener('pointerup', releaseStick);
stick.addEventListener('pointercancel', releaseStick);
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
    document.querySelector('#size').textContent = `${Math.max(1, own.radius / BASE_RADIUS).toFixed(1)}×`;
    if (!own.alive && gameOverNode.hidden) showGameOver(players, own);
  }
  const boundaryWarning = performance.now() < boundaryWarningUntil;
  eventNode.hidden = !snapshot.event && !boundaryWarning;
  eventNode.textContent = boundaryWarning ? 'SINIR TEMASI · ENERJİ VE BOYUT AZALIYOR' : snapshot.event?.message ?? '';
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
    const payload = message.offline ? { score: message.score, kills: message.kills, rank: 1 } : { resultToken: message.resultToken };
    const response = await window.SwarmRuntime.request('/api/v1/rewards/match', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload)
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
if (!window.SwarmRuntime.native && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
