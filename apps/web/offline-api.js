(function () {
  const STATE_KEY = 'swarm.offlineState.v1';
  const catalog = [
    { id: 'starter', name: 'Starter Core', rarity: 'Ücretsiz', price: 0, currency: 'Coins', description: 'Temiz, dengeli ve herkese açık başlangıç çekirdeği.' },
    { id: 'neon', name: 'Neon Bloom', rarity: 'Nadir', price: 200, currency: 'Coins', description: 'Mor enerji yaprakları ve canlı çekirdek parıltısı.' },
    { id: 'hex', name: 'Armored Hex', rarity: 'Nadir', price: 450, currency: 'Coins', description: 'Altıgen zırh plakaları ve güçlü cyan çerçeve.' },
    { id: 'solar', name: 'Solar Crown', rarity: 'Destansı', price: 900, currency: 'Coins', description: 'Güneş ışınlarıyla çevrili altın enerji kabuğu.' },
    { id: 'void', name: 'Void Phantom', rarity: 'Destansı', price: 220, currency: 'Gems', description: 'Karanlık çekirdek çevresinde dönen mor halkalar.' },
    { id: 'gold', name: 'Golden Sovereign', rarity: 'Efsanevi', price: 350, currency: 'Gems', description: 'Beyaz-altın zırh, taç ve kraliyet halkaları.' }
  ];
  const offers = [
    { id: 'spark', title: 'Kıvılcım Paketi', gems: 80, bonusLabel: '', webPriceLabel: '₺39,99', appleProductId: 'io.swarm.gems.spark', webAvailable: false },
    { id: 'nova', title: 'Nova Paketi', gems: 250, bonusLabel: '+%25 bonus', webPriceLabel: '₺99,99', appleProductId: 'io.swarm.gems.nova', webAvailable: false },
    { id: 'galaxy', title: 'Galaksi Paketi', gems: 700, bonusLabel: '+%40 bonus', webPriceLabel: '₺249,99', appleProductId: 'io.swarm.gems.galaxy', webAvailable: false }
  ];

  function initialState() {
    return {
      id: crypto.randomUUID(), nickname: 'Nova', coins: 500, gems: 0, equippedSkin: 'starter',
      owned: ['starter'], level: 1, experience: 0, totalMatches: 0, wins: 0,
      totalKills: 0, bestScore: 0, highestRank: 0, seasonXp: 0, dailyStreak: 0,
      lastDailyClaim: null, matches: []
    };
  }
  function read() {
    try { return { ...initialState(), ...JSON.parse(localStorage.getItem(STATE_KEY) || 'null') }; }
    catch { return initialState(); }
  }
  function write(state) { localStorage.setItem(STATE_KEY, JSON.stringify(state)); return state; }
  function response(body, status = 200) {
    return new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  function body(options) {
    try { return JSON.parse(options?.body || '{}'); } catch { return {}; }
  }
  function profile(state) {
    return { id: state.id, nickname: state.nickname, coins: state.coins, gems: state.gems, equippedSkin: state.equippedSkin };
  }
  function missions(state) {
    return [
      { id: 'play', title: '3 arena koşusu tamamla', period: 'GÜNLÜK', progress: Math.min(3, state.totalMatches), target: 3, coins: 150, xp: 80, complete: state.totalMatches >= 3 },
      { id: 'score', title: '500 enerji topla', period: 'GÜNLÜK', progress: Math.min(500, state.bestScore), target: 500, coins: 200, xp: 100, complete: state.bestScore >= 500 },
      { id: 'hunt', title: '5 rakip avla', period: 'GÜNLÜK', progress: Math.min(5, state.totalKills), target: 5, coins: 250, xp: 120, complete: state.totalKills >= 5 },
      { id: 'grow', title: '4× büyüklüğe ulaş', period: 'GÜNLÜK', progress: Math.min(4, Math.max(1, Math.floor(state.bestScore / 125))), target: 4, coins: 300, xp: 150, complete: state.bestScore >= 500 }
    ];
  }

  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    let state = read();
    if (path === '/health/live' || path === '/health/ready') return response({ status: 'offline-ready', mode: 'device' });
    if (path === '/api/v1/store/catalog') return response(catalog);
    if (path === '/api/v1/store/offers') return response(offers);
    if (path === '/api/v1/auth/guest' && method === 'POST') {
      const data = body(options); state.nickname = String(data.nickname || 'Nova').trim().slice(0, 24) || 'Nova'; write(state);
      return response({ accessToken: `offline.${state.id}`, player: profile(state), offline: true });
    }
    if (path === '/api/v1/profile' && method === 'GET') return response(profile(state));
    if (path === '/api/v1/profile' && method === 'DELETE') { localStorage.removeItem(STATE_KEY); return response(null, 204); }
    if (path === '/api/v1/inventory') return response({ items: state.owned.map(itemId => ({ itemId, isEquipped: itemId === state.equippedSkin })) });
    if (path === '/api/v1/store/purchase' && method === 'POST') {
      const item = catalog.find(entry => entry.id === body(options).itemId);
      if (!item || item.id === 'starter') return response({ error: 'INVALID_ITEM' }, 400);
      if (state.owned.includes(item.id)) return response({ error: 'ALREADY_OWNED' }, 409);
      const balanceKey = item.currency === 'Gems' ? 'gems' : 'coins';
      if (state[balanceKey] < item.price) return response({ error: 'INSUFFICIENT_FUNDS' }, 409);
      state[balanceKey] -= item.price; state.owned.push(item.id); write(state);
      return response({ coins: state.coins, gems: state.gems });
    }
    if (path === '/api/v1/inventory/equip' && method === 'POST') {
      const itemId = body(options).itemId;
      if (!state.owned.includes(itemId)) return response({ error: 'NOT_OWNED' }, 409);
      state.equippedSkin = itemId; write(state); return response({ equippedSkin: itemId });
    }
    if (path === '/api/v1/matchmaking/queue' && method === 'POST') return response({ offline: true, playerId: state.id });
    if (path === '/api/v1/rewards/match' && method === 'POST') {
      const data = body(options), score = Math.max(0, Number(data.score) || 0), kills = Math.max(0, Number(data.kills) || 0);
      const coins = Math.max(10, Math.floor(score / 10) + kills * 15), xp = Math.max(10, Math.floor(score / 8));
      state.totalMatches += 1; state.totalKills += kills; state.bestScore = Math.max(state.bestScore, score);
      state.coins += coins; state.experience += xp; state.seasonXp += xp; state.level = Math.max(1, Math.floor(state.experience / 500) + 1);
      state.matches.unshift({ id: crypto.randomUUID(), score, kills, rank: Number(data.rank) || 1, coinsEarned: coins, xpEarned: xp, playedAt: new Date().toISOString() });
      state.matches = state.matches.slice(0, 25); write(state); return response({ coins, xp, balance: state.coins });
    }
    if (path === '/api/v1/meta/home') return response({
      profile: { ...profile(state), level: state.level, experience: state.experience, totalMatches: state.totalMatches, wins: state.wins, totalKills: state.totalKills, bestScore: state.bestScore, highestRank: state.highestRank },
      dailyReward: { available: state.lastDailyClaim !== new Date().toISOString().slice(0, 10), streak: state.dailyStreak },
      missions: missions(state),
      season: { id: 'season-01', name: 'Cosmic Rise', level: Math.floor(state.seasonXp / 500) + 1, currentLevelXp: state.seasonXp % 500, nextLevelXp: 500, maxLevel: 50 }
    });
    if (path === '/api/v1/leaderboards/global') return response({ entries: [
      { rank: 1, nickname: state.nickname, level: state.level, score: state.bestScore },
      { rank: 2, nickname: 'Orion', level: 4, score: 420 }, { rank: 3, nickname: 'Vega', level: 3, score: 310 }
    ].sort((a, b) => b.score - a.score).map((entry, index) => ({ ...entry, rank: index + 1 })) });
    if (path === '/api/v1/matches/history') return response({ matches: state.matches });
    if (path === '/api/v1/rewards/daily' && method === 'POST') {
      const today = new Date().toISOString().slice(0, 10);
      if (state.lastDailyClaim === today) return response({ error: 'DAILY_ALREADY_CLAIMED', message: 'Günlük ödül bugün zaten alındı.' }, 409);
      state.dailyStreak += 1; state.lastDailyClaim = today; const coins = 100 + ((state.dailyStreak - 1) % 4) * 25; state.coins += coins; write(state);
      return response({ coins, gems: 0, streak: state.dailyStreak });
    }
    return response({ error: 'OFFLINE_ENDPOINT_UNAVAILABLE' }, 503);
  }

  window.SwarmOffline = { request, read, catalog, offers };
})();
