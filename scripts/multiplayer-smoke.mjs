const apiOrigin = process.env.SWARM_API_ORIGIN ?? 'http://localhost:5080';

async function request(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

async function login(index) {
  return request('/api/v1/auth/guest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: `multiplayer-smoke-${Date.now()}-${index}`, nickname: `Friend-${index}` })
  });
}

function authorization(session) { return { authorization: `Bearer ${session.accessToken}` }; }

const sessions = await Promise.all([1, 2, 3].map(login));
const missingRoom = await fetch(`${apiOrigin}/api/v1/matchmaking/queue?mode=private&roomCode=SW-NONE`, { method: 'POST', headers: authorization(sessions[0]) });
if (missingRoom.status !== 404) throw new Error(`Unknown room code must return 404, received ${missingRoom.status}.`);
const room = await request('/api/v1/matchmaking/rooms', { method: 'POST', headers: authorization(sessions[0]) });
const assignments = await Promise.all(sessions.map(session => request(`/api/v1/matchmaking/queue?mode=private&roomCode=${room.roomCode}`, {
  method: 'POST', headers: authorization(session)
})));

const sockets = assignments.map(assignment => new WebSocket(`${assignment.websocketUrl}?ticket=${encodeURIComponent(assignment.ticket)}`));
const snapshots = await Promise.all(sockets.map(socket => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for the three-player snapshot.')), 8000);
  socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed.')); }, { once: true });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type !== 'snapshot' || message.realPlayers !== 3) return;
    clearTimeout(timeout);
    resolve(message);
  });
})));

const compactSnapshot = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for a compact snapshot.')), 2500);
  const listener = event => {
    const message = JSON.parse(event.data);
    if (message.type !== 'snapshot' || Array.isArray(message.energy)) return;
    clearTimeout(timeout);
    sockets[0].removeEventListener('message', listener);
    resolve({ message, bytes: event.data.length });
  };
  sockets[0].addEventListener('message', listener);
});

for (const socket of sockets) socket.close();
const playerIds = new Set(sessions.map(session => session.player.id.toLowerCase()));
const sample = snapshots[0];
if (sample.capacity !== 50) throw new Error(`Expected capacity 50, received ${sample.capacity}.`);
if (sample.realPlayers !== 3 || sample.bots !== 21 || sample.players.length !== 24)
  throw new Error(`Expected 3 real + 21 bots, received ${sample.realPlayers} real + ${sample.bots} bots.`);
if (sample.roomCode !== room.roomCode) throw new Error('Players did not join the requested friend room.');
if (!Array.isArray(sample.energy) || sample.energy.length !== 300) throw new Error('Initial snapshot must contain the complete energy state.');
if (!Number.isFinite(sample.serverTimeMs)) throw new Error('Snapshot server timestamp is missing.');
const fullSnapshotBytes = JSON.stringify(sample).length;
if (compactSnapshot.bytes >= fullSnapshotBytes * .55)
  throw new Error(`Compact snapshot is unexpectedly large (${compactSnapshot.bytes}/${fullSnapshotBytes} bytes).`);
for (const playerId of playerIds) {
  const player = sample.players.find(candidate => candidate.id.toLowerCase() === playerId);
  if (!player || player.isBot) throw new Error(`Real player ${playerId} was not marked correctly.`);
}

console.log(JSON.stringify({ passed: true, roomCode: room.roomCode, capacity: sample.capacity, realPlayers: sample.realPlayers, bots: sample.bots, totalPlayers: sample.players.length, fullSnapshotBytes, compactSnapshotBytes: compactSnapshot.bytes }));
