import { DurableObject } from "cloudflare:workers";

interface Env {
  ASSETS: Fetcher;
  SWARM: DurableObjectNamespace<SwarmWorld>;
}

type Vec = { x: number; y: number };
type Player = {
  id: string; nickname: string; skinId: string; x: number; y: number; inputX: number; inputY: number;
  score: number; kills: number; radius: number; alive: boolean; isBot: boolean;
  shieldUntil: number; shieldReady: number; magnetUntil: number; magnetReady: number;
  dashUntil: number; dashReady: number; lastX: number; lastY: number; boundaryReady: number; zeroHits: number;
};
type Orb = { id: string; x: number; y: number; value: number; kind: string };
type Profile = {
  id: string; deviceHash: string; nickname: string; coins: number; gems: number; equippedSkin: string;
  owned: string[]; level: number; experience: number; totalMatches: number; wins: number; totalKills: number;
  bestScore: number; highestRank: number; seasonXp: number; dailyStreak: number; lastDailyClaim: string | null;
  matches: Array<{ id: string; score: number; kills: number; rank: number; coinsEarned: number; xpEarned: number; playedAt: string }>;
};
type Session = { playerId: string; expires: number };
type Ticket = { playerId: string; nickname: string; skinId: string; mode: string; roomCode: string | null; expires: number };

const CATALOG = [
  { id: "starter", name: "Starter Core", rarity: "Ücretsiz", price: 0, currency: "Coins", description: "Temiz ve dengeli başlangıç çekirdeği.", traitName: "SINIR DİRENCİ", traitDescription: "Sınır enerji cezası %20 daha az." },
  { id: "neon", name: "Neon Bloom", rarity: "Nadir", price: 200, currency: "Coins", description: "Mor enerji yaprakları ve canlı çekirdek parıltısı.", traitName: "GENİŞ ÇEKİM", traitDescription: "Çekim menzili %35 daha geniş." },
  { id: "hex", name: "Armored Hex", rarity: "Nadir", price: 450, currency: "Coins", description: "Altıgen zırh plakaları ve güçlü cyan çerçeve.", traitName: "UZUN KALKAN", traitDescription: "Kalkan %40 daha uzun sürer." },
  { id: "solar", name: "Solar Crown", rarity: "Destansı", price: 900, currency: "Coins", description: "Güneş ışınlarıyla çevrili altın enerji kabuğu.", traitName: "GÜNEŞ HASADI", traitDescription: "Toplanan enerji %15 daha değerlidir." },
  { id: "void", name: "Void Phantom", rarity: "Destansı", price: 220, currency: "Gems", description: "Karanlık çekirdek çevresinde dönen mor halkalar.", traitName: "FANTOM AKIŞ", traitDescription: "Hareket hızı %10 daha yüksektir." },
  { id: "gold", name: "Golden Sovereign", rarity: "Efsanevi", price: 350, currency: "Gems", description: "Beyaz-altın zırh, taç ve kraliyet halkaları.", traitName: "KRALİYET ATILIŞI", traitDescription: "Atıl gücü %25 daha yüksektir." }
];
const OFFERS = [
  { id: "spark", title: "Kıvılcım Paketi", gems: 80, bonusLabel: "", webPriceLabel: "₺39,99", appleProductId: "io.swarm.gems.spark", googleProductId: "io.swarm.gems.spark", webAvailable: false },
  { id: "nova", title: "Nova Paketi", gems: 250, bonusLabel: "+%25 bonus", webPriceLabel: "₺99,99", appleProductId: "io.swarm.gems.nova", googleProductId: "io.swarm.gems.nova", webAvailable: false },
  { id: "galaxy", title: "Galaksi Paketi", gems: 700, bonusLabel: "+%40 bonus", webPriceLabel: "₺249,99", appleProductId: "io.swarm.gems.galaxy", googleProductId: "io.swarm.gems.galaxy", webAvailable: false }
];
const BOT_NAMES = ["Vortex","Toxic","Nyx","Blaze","Khan","Pixel","Orion","Ghost","Razor","Luna","Apex","Volt","Mamba","Comet","Hex","Frost","Venom","Drift","Echo","Onyx","Flux","Titan","Pulsar","Vega"];
const SKINS = ["starter","neon","hex","solar","void","gold"];
const ZONES = [
  { id: "speed-north", kind: "speed", position: { x: 800, y: 430 }, radius: 240 },
  { id: "gold-south", kind: "gold", position: { x: 2420, y: 1380 }, radius: 260 },
  { id: "gravity-core", kind: "gravity", position: { x: 1600, y: 900 }, radius: 210 }
];
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extra } });
}
function cors(origin: string | null): Record<string, string> {
  const allowed = origin === "capacitor://localhost" || origin === "ionic://localhost" || origin?.endsWith(".workers.dev");
  return allowed ? { "access-control-allow-origin": origin!, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", vary: "Origin" } : {};
}
function normalizeNickname(value: unknown) { return String(value || "Nova").trim().replace(/\s+/g, " ").slice(0, 24) || "Nova"; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function randomPosition(): Vec { return { x: 50 + Math.random() * 3100, y: 50 + Math.random() * 1700 }; }
const BASE_PLAYER_RADIUS = 22;
const BASE_PLAYER_SPEED = 245;
function radiusFor(score: number) { return BASE_PLAYER_RADIUS + Math.sqrt(Math.max(0, score)) * 1.22; }
function movementSpeedFor(radius: number) { return Math.max(72, BASE_PLAYER_SPEED / Math.pow(Math.max(1, radius / BASE_PLAYER_RADIUS), .72)); }
function distance2(a: Vec, b: Vec) { const x = a.x - b.x, y = a.y - b.y; return x * x + y * y; }
function normalize(x: number, y: number): Vec { const length = Math.hypot(x, y); return length > .0001 ? { x: x / length, y: y / length } : { x: 0, y: 0 }; }
function dateKey() { return new Date().toISOString().slice(0, 10); }
function newProfile(deviceHash: string, nickname: string): Profile {
  return { id: crypto.randomUUID(), deviceHash, nickname, coins: 500, gems: 0, equippedSkin: "starter", owned: ["starter"], level: 1, experience: 0, totalMatches: 0, wins: 0, totalKills: 0, bestScore: 0, highestRank: 0, seasonXp: 0, dailyStreak: 0, lastDailyClaim: null, matches: [] };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/") || url.pathname.startsWith("/ws/")) {
      const response = await env.SWARM.getByName("global").fetch(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors(request.headers.get("origin")))) headers.set(key, value);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "strict-origin-when-cross-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers, webSocket: response.webSocket });
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

class ArenaRoom {
  readonly id = crypto.randomUUID();
  readonly players = new Map<string, Player>();
  readonly sockets = new Map<string, WebSocket>();
  readonly resultSent = new Set<string>();
  readonly energy = new Map<string, Orb>();
  readonly previousEnergy = new Set<string>();
  readonly started = Date.now();
  tick = 0;
  private botSequence = 0;
  constructor(readonly code: string | null, readonly isPrivate: boolean) { this.refillEnergy(); this.rebalanceBots(); }
  get finished() { return Date.now() >= this.started + 300_000; }
  get remaining() { return Math.max(0, Math.ceil((this.started + 300_000 - Date.now()) / 1000)); }
  get realCount() { return [...this.players.values()].filter(p => !p.isBot).length; }
  addHuman(ticket: Ticket, socket: WebSocket) {
    let player = this.players.get(ticket.playerId);
    if (!player || !player.alive) player = this.makePlayer(ticket.playerId, ticket.nickname, ticket.skinId, false, 0);
    player.nickname = ticket.nickname; player.skinId = ticket.skinId; player.alive = true;
    this.players.set(player.id, player); this.sockets.set(player.id, socket); this.rebalanceBots();
  }
  removeHuman(id: string) { this.sockets.delete(id); this.players.delete(id); this.resultSent.delete(id); this.rebalanceBots(); }
  input(id: string, message: { x?: number; y?: number; dash?: boolean; ability?: string }) {
    const p = this.players.get(id); if (!p?.alive) return;
    const direction = normalize(Number(message.x) || 0, Number(message.y) || 0);
    p.inputX = direction.x; p.inputY = direction.y;
    if (direction.x || direction.y) { p.lastX = direction.x; p.lastY = direction.y; }
    if (message.dash && this.tick >= p.dashReady) { p.dashUntil = this.tick + 6; p.dashReady = this.tick + 80; }
    if (message.ability === "shield" && this.tick >= p.shieldReady) { p.shieldUntil = this.tick + (p.skinId === "hex" ? 84 : 60); p.shieldReady = this.tick + 300; }
    if (message.ability === "magnet" && this.tick >= p.magnetReady) { p.magnetUntil = this.tick + 100; p.magnetReady = this.tick + 260; }
  }
  step() {
    if (this.finished) return;
    this.updateBots();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const speedTrait = p.skinId === "void" ? 1.1 : 1;
      let speed = movementSpeedFor(p.radius) * speedTrait;
      if (this.tick < p.dashUntil) speed *= 1.85 * (p.skinId === "gold" ? 1.25 : 1);
      const speedZone = ZONES[0]; if (distance2({ x: p.x, y: p.y }, speedZone.position) <= speedZone.radius ** 2) speed *= 1.3;
      let x = p.x + p.inputX * speed * .05, y = p.y + p.inputY * speed * .05;
      const gravity = ZONES[2];
      if (distance2({ x: p.x, y: p.y }, gravity.position) <= gravity.radius ** 2) { const pull = normalize(gravity.position.x - p.x, gravity.position.y - p.y); x += pull.x * 2.75; y += pull.y * 2.75; }
      const hit = x <= p.radius || x >= 3200 - p.radius || y <= p.radius || y >= 1800 - p.radius;
      p.x = clamp(x, p.radius, 3200 - p.radius); p.y = clamp(y, p.radius, 1800 - p.radius);
      if (hit && this.tick >= p.boundaryReady) {
        const trait = p.skinId === "starter" ? .8 : 1;
        p.score = Math.max(0, p.score - Math.min(p.score, Math.max(1, Math.floor(Math.max(4, Math.ceil(p.score * .04)) * trait))));
        p.radius = radiusFor(p.score); p.zeroHits = p.score === 0 ? p.zeroHits + 1 : 0; p.alive = p.zeroHits < 3; p.boundaryReady = this.tick + 14;
      } else if (!hit) p.zeroHits = 0;
      if (!p.alive) continue;
      const magnet = this.tick < p.magnetUntil; const reach = p.radius + (magnet ? 115 * (p.skinId === "neon" ? 1.35 : 1) : 8);
      for (const orb of this.energy.values()) {
        if (distance2({ x: p.x, y: p.y }, { x: orb.x, y: orb.y }) > reach * reach) continue;
        this.energy.delete(orb.id);
        const gold = distance2({ x: p.x, y: p.y }, ZONES[1].position) <= ZONES[1].radius ** 2 ? 2 : 1;
        const traitValue = p.skinId === "solar" ? Math.max(orb.value, Math.round(orb.value * 1.15)) : orb.value;
        p.score += traitValue * gold; p.radius = radiusFor(p.score);
      }
    }
    const alive = [...this.players.values()].filter(p => p.alive);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j]; const collision = Math.max(12, (a.radius + b.radius) * .72);
      if (distance2({ x: a.x, y: a.y }, { x: b.x, y: b.y }) > collision * collision) continue;
      const hunter = a.radius > b.radius * 1.025 ? a : b.radius > a.radius * 1.025 ? b : null;
      if (!hunter) continue; const victim = hunter === a ? b : a;
      if (this.tick < victim.shieldUntil) continue;
      hunter.score += 25 + Math.floor(victim.score / 2); hunter.kills++; hunter.radius = radiusFor(hunter.score); victim.alive = false;
    }
    this.refillEnergy(); this.tick++;
  }
  snapshot(full: boolean) {
    const ids = new Set(this.energy.keys());
    const added = [...this.energy.values()].filter(o => !this.previousEnergy.has(o.id));
    const removed = [...this.previousEnergy].filter(id => !ids.has(id));
    this.previousEnergy.clear(); for (const id of ids) this.previousEnergy.add(id);
    return { type: "snapshot", roomId: this.id, roomCode: this.code, isPrivate: this.isPrivate, capacity: 50, realPlayers: this.realCount, bots: [...this.players.values()].filter(p => p.isBot).length, matchDurationSeconds: 300, remainingSeconds: this.remaining, matchFinished: this.finished, arenaWidth: 3200, arenaHeight: 1800, serverTimeMs: this.tick * 50, tick: this.tick,
      players: [...this.players.values()].map(p => [p.id,p.nickname,p.skinId,+p.x.toFixed(1),+p.y.toFixed(1),p.score,p.kills,+p.radius.toFixed(1),p.alive?1:0,p.isBot?1:0,this.tick<p.shieldUntil?1:0,this.tick<p.magnetUntil?1:0]),
      energy: full ? [...this.energy.values()].map(o => [o.id,+o.x.toFixed(1),+o.y.toFixed(1),o.value,o.kind]) : undefined,
      energyAdded: !full && added.length ? added.map(o => [o.id,+o.x.toFixed(1),+o.y.toFixed(1),o.value,o.kind]) : undefined,
      energyRemoved: !full && removed.length ? removed : undefined, zones: full ? ZONES : undefined };
  }
  private makePlayer(id: string, nickname: string, skinId: string, isBot: boolean, score: number): Player {
    const pos = randomPosition(); return { id,nickname,skinId,x:pos.x,y:pos.y,inputX:0,inputY:0,score,kills:0,radius:radiusFor(score),alive:true,isBot,shieldUntil:0,shieldReady:0,magnetUntil:0,magnetReady:0,dashUntil:0,dashReady:0,lastX:0,lastY:-1,boundaryReady:0,zeroHits:0 };
  }
  private rebalanceBots() {
    const desired = clamp(24 - this.realCount, 0, 50 - this.realCount);
    const bots = [...this.players.values()].filter(p => p.isBot);
    while (bots.length > desired) { const bot = bots.pop()!; this.players.delete(bot.id); }
    while (bots.length < desired) { const index = this.botSequence++; const name = BOT_NAMES[index % BOT_NAMES.length] + (index >= BOT_NAMES.length ? `-${1 + Math.floor(index / BOT_NAMES.length)}` : ""); const bot = this.makePlayer(`bot-${crypto.randomUUID()}`, name, SKINS[index % SKINS.length], true, Math.floor(Math.random() * 80)); this.players.set(bot.id, bot); bots.push(bot); }
  }
  private updateBots() {
    const orbs = [...this.energy.values()]; if (!orbs.length) return;
    for (const bot of this.players.values()) if (bot.isBot) {
      if (!bot.alive) { const fresh = this.makePlayer(bot.id, bot.nickname, bot.skinId, true, Math.floor(Math.random() * 30)); this.players.set(bot.id, fresh); continue; }
      let target = orbs[Math.floor(Math.random() * orbs.length)]; let best = Infinity;
      for (let i = 0; i < orbs.length; i += 12) { const orb = orbs[i]; const d = distance2({ x: bot.x, y: bot.y }, { x: orb.x, y: orb.y }) / Math.max(1, orb.value); if (d < best) { best = d; target = orb; } }
      const direction = normalize(target.x - bot.x, target.y - bot.y); bot.inputX = direction.x; bot.inputY = direction.y;
    }
  }
  private refillEnergy() { while (this.energy.size < 300) { const roll = Math.random(); const [value, kind] = roll < .012 ? [30,"core"] : roll < .06 ? [15,"epic"] : roll < .2 ? [5,"rare"] : [1,"common"]; const pos = randomPosition(), id = crypto.randomUUID(); this.energy.set(id, { id, x: pos.x, y: pos.y, value: value as number, kind: kind as string }); } }
}

export class SwarmWorld extends DurableObject<Env> {
  private rooms = new Map<string, ArenaRoom>();
  private socketRoom = new Map<WebSocket, { room: ArenaRoom; playerId: string }>();
  private loop: ReturnType<typeof setInterval> | null = null;
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/health/live") return json({ status: "live", platform: "cloudflare" });
    if (path === "/health/ready") return json({ status: "ready", players: [...this.rooms.values()].reduce((n,r)=>n+r.realCount,0), arenas: this.rooms.size });
    if (path === "/ws/arena") return this.upgrade(request, url);
    const auth = await this.authorize(request);
    if (path === "/api/v1/store/catalog") return json(CATALOG);
    if (path === "/api/v1/store/offers") return json(OFFERS);
    if (path === "/api/v1/auth/guest" && request.method === "POST") return this.guest(request);
    if (path === "/api/v1/leaderboards/global") return this.leaderboard();
    if (path === "/api/v1/config") return json({ minimumSupportedVersion: "1.0.0", latestVersion: "1.0.0", maintenance: false, features: { cloudflareRealtime: "true" } });
    if (!auth) return json({ error: "UNAUTHORIZED" }, 401);
    const profile = await this.profile(auth.playerId); if (!profile) return json({ error: "NOT_FOUND" }, 404);
    if (path === "/api/v1/profile" && request.method === "GET") return json(this.publicProfile(profile));
    if (path === "/api/v1/profile" && request.method === "DELETE") { await this.ctx.storage.delete([`player:${profile.id}`,`device:${profile.deviceHash}`]); return new Response(null,{status:204}); }
    if (path === "/api/v1/inventory") return json({ items: profile.owned.map(itemId => ({ itemId, isEquipped: itemId === profile.equippedSkin })) });
    if (path === "/api/v1/store/purchase" && request.method === "POST") return this.purchase(request, profile);
    if (path === "/api/v1/inventory/equip" && request.method === "POST") return this.equip(request, profile);
    if (path === "/api/v1/store/web-checkout") return json({ error: "PAYMENTS_NOT_CONFIGURED", message: "Web ödemeleri kapalıdır." }, 503);
    if (path === "/api/v1/payments/apple/complete") return json({ error: "APPLE_VERIFICATION_NOT_CONFIGURED", message: "Apple satın alma doğrulaması henüz etkin değil." }, 503);
    if (path === "/api/v1/matchmaking/rooms" && request.method === "POST") return this.createRoom();
    if (path === "/api/v1/matchmaking/queue" && request.method === "POST") return this.queue(url, request, profile);
    if (path === "/api/v1/rewards/match" && request.method === "POST") return this.reward(request, profile);
    if (path === "/api/v1/meta/home") return json(this.home(profile));
    if (path === "/api/v1/matches/history") return json({ matches: profile.matches });
    if (path === "/api/v1/rewards/daily" && request.method === "POST") return this.daily(profile);
    if (path === "/api/v1/reports" || path === "/api/v1/analytics/events") return json({ success: true }, 202);
    return json({ error: "NOT_FOUND" }, 404);
  }

  private async guest(request: Request) {
    const body = await request.json().catch(() => ({})) as { deviceId?: string; nickname?: string };
    const deviceId = String(body.deviceId || "").slice(0,256); if (!deviceId) return json({ error: "INVALID_DEVICE" },400);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId)); const hash = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
    let playerId = await this.ctx.storage.get<string>(`device:${hash}`); let profile = playerId ? await this.profile(playerId) : null;
    if (!profile) { profile = newProfile(hash, normalizeNickname(body.nickname)); playerId = profile.id; await this.ctx.storage.put(`device:${hash}`, playerId); }
    profile.nickname = normalizeNickname(body.nickname); await this.save(profile);
    const token = crypto.randomUUID()+crypto.randomUUID(); await this.ctx.storage.put(`session:${token}`, { playerId: profile.id, expires: Date.now()+43_200_000 } satisfies Session);
    return json({ accessToken: token, player: this.publicProfile(profile) });
  }
  private async authorize(request: Request) { const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i,""); if (!token) return null; const session = await this.ctx.storage.get<Session>(`session:${token}`); return session && session.expires > Date.now() ? session : null; }
  private profile(id: string) { return this.ctx.storage.get<Profile>(`player:${id}`); }
  private save(profile: Profile) { return this.ctx.storage.put(`player:${profile.id}`, profile); }
  private publicProfile(p: Profile) { return { id:p.id,nickname:p.nickname,coins:p.coins,gems:p.gems,equippedSkin:p.equippedSkin }; }
  private async purchase(request: Request, p: Profile) { const body=await request.json().catch(()=>({})) as {itemId?:string}; const item=CATALOG.find(x=>x.id===body.itemId); if(!item||item.id==="starter")return json({error:"INVALID_ITEM"},400); if(p.owned.includes(item.id))return json({error:"ALREADY_OWNED"},409); const key=item.currency==="Gems"?"gems":"coins"; if(p[key]<item.price)return json({error:"INSUFFICIENT_FUNDS"},400); p[key]-=item.price;p.owned.push(item.id);await this.save(p);return json({itemId:item.id,coins:p.coins,gems:p.gems}); }
  private async equip(request: Request,p:Profile){const body=await request.json().catch(()=>({})) as {itemId?:string};if(!body.itemId||!p.owned.includes(body.itemId))return json({error:"NOT_OWNED"},400);p.equippedSkin=body.itemId;await this.save(p);return json({equippedSkin:p.equippedSkin});}
  private async createRoom(){let code="";do{code="SW-"+Math.random().toString(36).slice(2,6).toUpperCase();}while(await this.ctx.storage.get(`room:${code}`));await this.ctx.storage.put(`room:${code}`,{expires:Date.now()+3_600_000});return json({roomCode:code,capacity:50});}
  private async queue(url:URL,request:Request,p:Profile){const mode=url.searchParams.get("mode")==="private"?"private":"public";const code=mode==="private"?(url.searchParams.get("roomCode")||"").trim().toUpperCase():null;if(code&&!/^SW-[A-Z0-9]{4}$/.test(code))return json({error:"INVALID_ROOM_CODE",message:"Oda kodu SW-XXXX biçiminde olmalıdır."},400);const roomRecord=code?await this.ctx.storage.get<{expires:number}>(`room:${code}`):null;if(code&&(!roomRecord||roomRecord.expires<Date.now()))return json({error:"ROOM_NOT_FOUND",message:"Bu arkadaş odası bulunamadı veya süresi doldu."},404);const ticket=crypto.randomUUID()+crypto.randomUUID();await this.ctx.storage.put(`ticket:${ticket}`,{playerId:p.id,nickname:p.nickname,skinId:p.equippedSkin,mode,roomCode:code,expires:Date.now()+120_000} satisfies Ticket);const origin=new URL(request.url);origin.protocol=origin.protocol==="https:"?"wss:":"ws:";origin.pathname="/ws/arena";origin.search="";return json({ticket,websocketUrl:origin.toString().replace(/\/$/,""),mode,roomCode:code,capacity:50,expiresInSeconds:120});}
  private async upgrade(request:Request,url:URL){if(request.headers.get("Upgrade")!=="websocket")return json({error:"WEBSOCKET_REQUIRED"},400);const token=url.searchParams.get("ticket")||"";const ticket=await this.ctx.storage.get<Ticket>(`ticket:${token}`);if(!ticket||ticket.expires<Date.now())return json({error:"INVALID_TICKET"},401);await this.ctx.storage.delete(`ticket:${token}`);const key=ticket.mode==="private"?`private:${ticket.roomCode}`:"public:0";let room=this.rooms.get(key);if(!room||room.finished||room.realCount>=50){if(ticket.mode==="private"&&room&&room.realCount>=50)return json({error:"ROOM_FULL"},409);room=new ArenaRoom(ticket.roomCode,ticket.mode==="private");this.rooms.set(key,room);}const activeRoom=room;const pair=new WebSocketPair();const [client,server]=Object.values(pair) as [WebSocket,WebSocket];server.accept();activeRoom.addHuman(ticket,server);this.socketRoom.set(server,{room:activeRoom,playerId:ticket.playerId});server.addEventListener("message",event=>{try{activeRoom.input(ticket.playerId,JSON.parse(String(event.data)));}catch{}});const close=()=>{activeRoom.removeHuman(ticket.playerId);this.socketRoom.delete(server);};server.addEventListener("close",close);server.addEventListener("error",close);server.send(JSON.stringify(activeRoom.snapshot(true)));this.ensureLoop();return new Response(null,{status:101,webSocket:client});}
  private ensureLoop(){if(this.loop)return;this.loop=setInterval(()=>{for(const [key,room] of this.rooms){room.step();if(room.tick%2===0||room.finished){const message=JSON.stringify(room.snapshot(false));for(const [id,socket]of room.sockets){try{socket.send(message);const p=room.players.get(id);if(p&&(!p.alive||room.finished)&&!room.resultSent.has(id)){room.resultSent.add(id);const rank=[...room.players.values()].filter(x=>x.score>p.score).length+1;const coins=10+Math.floor(p.score/5)+p.kills*25;const result=crypto.randomUUID()+crypto.randomUUID();this.ctx.storage.put(`result:${result}`,{playerId:id,score:p.score,kills:p.kills,rank,coins,durationSeconds:Math.max(1,Math.floor((Date.now()-room.started)/1000))});socket.send(JSON.stringify({type:"gameOver",reason:room.finished?"timeout":"eliminated",score:p.score,kills:p.kills,rank,coins,durationSeconds:Math.max(1,Math.floor((Date.now()-room.started)/1000)),resultToken:result}));}}catch{room.removeHuman(id);}}}if(room.finished&&room.realCount===0)this.rooms.delete(key);}if([...this.rooms.values()].every(r=>r.realCount===0)){clearInterval(this.loop!);this.loop=null;}},50);}
  private async reward(request:Request,p:Profile){const body=await request.json().catch(()=>({})) as {resultToken?:string};if(!body.resultToken)return json({error:"INVALID_MATCH_RESULT"},400);const result=await this.ctx.storage.get<{playerId:string;score:number;kills:number;rank:number;coins:number;durationSeconds:number}>(`result:${body.resultToken}`);if(!result||result.playerId!==p.id)return json({error:"INVALID_MATCH_RESULT"},400);await this.ctx.storage.delete(`result:${body.resultToken}`);const xp=25+Math.floor(result.score/4)+result.kills*20;p.coins+=result.coins;p.totalMatches++;p.totalKills+=result.kills;p.bestScore=Math.max(p.bestScore,result.score);p.highestRank=p.highestRank?Math.min(p.highestRank,result.rank):result.rank;if(result.rank===1)p.wins++;p.experience+=xp;p.seasonXp+=xp;p.level=Math.max(1,Math.floor(p.experience/500)+1);p.matches.unshift({id:crypto.randomUUID(),score:result.score,kills:result.kills,rank:result.rank,coinsEarned:result.coins,xpEarned:xp,playedAt:new Date().toISOString()});p.matches=p.matches.slice(0,25);await this.save(p);return json({...result,xp,level:p.level,balance:p.coins,alreadyClaimed:false});}
  private home(p:Profile){const missions=[{id:"play",title:"3 arena koşusu tamamla",period:"GÜNLÜK",progress:Math.min(3,p.totalMatches),target:3,coins:150,xp:80,complete:p.totalMatches>=3},{id:"score",title:"500 enerji topla",period:"GÜNLÜK",progress:Math.min(500,p.bestScore),target:500,coins:200,xp:100,complete:p.bestScore>=500},{id:"hunt",title:"5 rakip avla",period:"GÜNLÜK",progress:Math.min(5,p.totalKills),target:5,coins:250,xp:120,complete:p.totalKills>=5},{id:"grow",title:"4× büyüklüğe ulaş",period:"GÜNLÜK",progress:Math.min(4,Math.max(1,Math.floor(p.bestScore/125))),target:4,coins:300,xp:150,complete:p.bestScore>=500}];return{profile:{...this.publicProfile(p),level:p.level,experience:p.experience,totalMatches:p.totalMatches,wins:p.wins,totalKills:p.totalKills,bestScore:p.bestScore,highestRank:p.highestRank},dailyReward:{available:p.lastDailyClaim!==dateKey(),streak:p.dailyStreak,nextDay:(p.dailyStreak%7)+1},missions,season:{id:"season-01",name:"Cosmic Rise",level:Math.floor(p.seasonXp/500)+1,currentLevelXp:p.seasonXp%500,nextLevelXp:500,maxLevel:50},announcement:{title:"SEASON 01 · COSMIC RISE",message:"Görevleri tamamla, sezon yolunda yüksel ve kozmetik ödülleri aç."}};}
  private async daily(p:Profile){const today=dateKey();if(p.lastDailyClaim===today)return json({error:"DAILY_ALREADY_CLAIMED",message:"Günlük ödül bugün zaten alındı."},409);p.dailyStreak++;p.lastDailyClaim=today;const day=((p.dailyStreak-1)%7)+1;const coins=day===1?100:day===2?125:day===3?150:day===4?175:day===6?250:day===7?500:0;const gems=day===5?10:0;p.coins+=coins;p.gems+=gems;await this.save(p);return json({day,coins,gems,streak:p.dailyStreak,balanceCoins:p.coins,balanceGems:p.gems});}
  private async leaderboard(){const entries=(await this.ctx.storage.list<Profile>({prefix:"player:",limit:100})).values();const rows=[...entries].sort((a,b)=>b.bestScore-a.bestScore).map((p,i)=>({rank:i+1,id:p.id,nickname:p.nickname,level:p.level,score:p.bestScore,kills:p.totalKills,matches:p.totalMatches}));return json({updatedAt:new Date().toISOString(),entries:rows});}
}
