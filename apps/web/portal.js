const token = sessionStorage.getItem('swarm.accessToken');
const headers = () => ({ authorization: `Bearer ${token}` });
const toastNode = document.querySelector('#portal-toast');

async function api(path, options = {}) {
  const response = await window.SwarmRuntime.request(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'İşlem başarısız.');
  return data;
}
function toast(message) { toastNode.textContent = message; toastNode.classList.add('show'); setTimeout(() => toastNode.classList.remove('show'), 2600); }
function safe(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }

function renderHome(data) {
  const { profile, dailyReward, missions, season } = data;
  document.querySelector('#portal-name').textContent = profile.nickname;
  document.querySelector('#portal-level').textContent = profile.level;
  document.querySelector('#portal-stats').textContent = `${profile.totalMatches} maç · ${profile.totalKills} avlama · en iyi ${profile.bestScore.toLocaleString('tr-TR')} enerji`;
  document.querySelector('#portal-coins').textContent = profile.coins.toLocaleString('tr-TR');
  document.querySelector('#portal-gems').textContent = profile.gems.toLocaleString('tr-TR');
  const daily = document.querySelector('#daily-claim');
  daily.disabled = !dailyReward.available;
  daily.innerHTML = dailyReward.available ? `GÜNLÜK ÖDÜLÜ AL · ${dailyReward.streak + 1}. GÜN <span>→</span>` : 'BUGÜNKÜ ÖDÜL ALINDI ✓';
  document.querySelector('#mission-count').textContent = `${missions.filter(item => item.complete).length}/${missions.length}`;
  document.querySelector('#mission-list').innerHTML = missions.map(item => `<div class="mission-row ${item.complete ? 'complete' : ''}"><div><b>${safe(item.title)}</b><br><small>${item.period} · ${item.progress}/${item.target}</small></div><span>+${item.coins} ● · +${item.xp} XP</span><div class="bar"><i style="width:${Math.min(100, item.progress / item.target * 100)}%"></i></div></div>`).join('');
  document.querySelector('#season-name').textContent = season.name;
  document.querySelector('#season-level').textContent = `LV ${season.level}`;
  document.querySelector('#season-progress').style.width = `${season.currentLevelXp / season.nextLevelXp * 100}%`;
  document.querySelector('#season-copy').textContent = `${season.currentLevelXp.toLocaleString('tr-TR')} / ${season.nextLevelXp.toLocaleString('tr-TR')} XP · ${season.maxLevel} seviyeye kadar`;
}

function renderBoard(data) {
  document.querySelector('#global-board').innerHTML = data.entries.slice(0, 10).map(item => `<li><b>#${item.rank}</b><span>${safe(item.nickname)}<br><small>Seviye ${item.level}</small></span><strong>${item.score.toLocaleString('tr-TR')}</strong></li>`).join('') || '<div class="empty">İlk skorunu sen bırak.</div>';
}
function renderHistory(data) {
  document.querySelector('#match-history').innerHTML = data.matches.map(item => `<div class="history-row"><time>${new Date(item.playedAt).toLocaleDateString('tr-TR')}</time><b>${item.score.toLocaleString('tr-TR')} skor</b><span>${item.kills} avlama</span><span>+${item.coinsEarned} ●</span></div>`).join('') || '<div class="empty">Henüz tamamlanmış maç yok. Arenaya gir ve ilk izini bırak.</div>';
}

document.querySelector('#daily-claim').addEventListener('click', async () => {
  try {
    const reward = await api('/api/v1/rewards/daily', { method: 'POST', headers: headers() });
    toast(`Ödül alındı: +${reward.coins} altın${reward.gems ? `, +${reward.gems} kristal` : ''}`);
    await load();
  } catch (error) { toast(error.message); }
});

async function load() {
  if (!token) return location.replace(window.SwarmRuntime.homeUrl);
  try {
    const [home, board, history] = await Promise.all([
      api('/api/v1/meta/home', { headers: headers() }), api('/api/v1/leaderboards/global'), api('/api/v1/matches/history', { headers: headers() })
    ]);
    renderHome(home); renderBoard(board); renderHistory(history);
  } catch { sessionStorage.removeItem('swarm.accessToken'); location.replace(window.SwarmRuntime.homeUrl); }
}
load();
if (!window.SwarmRuntime.native && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
