let adminKey = sessionStorage.getItem('swarm.adminKey') || '';
const login = document.querySelector('#admin-login'), dashboard = document.querySelector('#admin-dashboard');
function adminHeaders(json = false) { return { 'x-admin-key': adminKey, ...(json ? { 'content-type': 'application/json' } : {}) }; }
async function adminApi(path, options = {}) { const response = await fetch(path, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 401 ? 'Yönetici anahtarı geçersiz.' : data.message || 'İşlem başarısız.'); return data; }
function safe(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function toast(value) { const node = document.querySelector('#admin-toast'); node.textContent = value; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2200); }
function metric(label, value) { return `<div class="metric"><span>${label}</span><b>${Number(value).toLocaleString('tr-TR')}</b></div>`; }
async function loadDashboard(search = '') {
  const [overview, players, reports, config] = await Promise.all([
    adminApi('/api/v1/admin/overview', { headers: adminHeaders() }),
    adminApi(`/api/v1/admin/players?search=${encodeURIComponent(search)}`, { headers: adminHeaders() }),
    adminApi('/api/v1/admin/reports', { headers: adminHeaders() }), fetch('/api/v1/config').then(response => response.json())
  ]);
  login.hidden = true; dashboard.hidden = false; document.querySelector('#admin-state').textContent = 'CANLI'; document.querySelector('#admin-state').style.color = '#59e4ed';
  document.querySelector('#admin-metrics').innerHTML = metric('TOPLAM OYUNCU', overview.players)+metric('24S MAÇ', overview.matches24h)+metric('24S SATIN ALMA', overview.purchases24h)+metric('AÇIK RAPOR', overview.openReports)+metric('ŞÜPHELİ MAÇ', overview.suspiciousMatches)+metric('24S EKONOMİ', overview.economyVolume24h);
  document.querySelector('#admin-players').innerHTML = players.map(player => `<tr><td><b>${safe(player.nickname)}</b><br><small>${player.id.slice(0,8)}</small></td><td>${player.coins.toLocaleString('tr-TR')}</td><td>${player.gems.toLocaleString('tr-TR')}</td><td>${new Date(player.updatedAt).toLocaleString('tr-TR')}</td></tr>`).join('');
  document.querySelector('#admin-reports').innerHTML = reports.map(report => `<div class="report"><b>${safe(report.reportedNickname)} · ${safe(report.reason)}</b><span>${new Date(report.createdAt).toLocaleString('tr-TR')} · ${safe(report.status)}</span><small>${safe(report.details || 'Ayrıntı yok')}</small></div>`).join('') || '<div class="report"><span>Açık rapor yok.</span></div>';
  document.querySelector('#admin-config').innerHTML = Object.entries(config.features).map(([key,value]) => `<label class="config-row"><b>${safe(key)}</b><small>Canlı değer</small><input data-config="${safe(key)}" value="${safe(value)}"><button data-save="${safe(key)}" type="button">KAYDET</button></label>`).join('');
}
document.querySelector('#admin-form').addEventListener('submit', async event => { event.preventDefault(); adminKey = document.querySelector('#admin-key').value; try { await loadDashboard(); sessionStorage.setItem('swarm.adminKey', adminKey); } catch (error) { document.querySelector('#admin-error').textContent = error.message; } });
document.querySelector('#admin-lock').addEventListener('click', () => { sessionStorage.removeItem('swarm.adminKey'); location.reload(); });
document.querySelector('#admin-refresh').addEventListener('click', () => loadDashboard(document.querySelector('#player-search').value).catch(error => toast(error.message)));
document.querySelector('#player-search').addEventListener('change', event => loadDashboard(event.target.value).catch(error => toast(error.message)));
document.querySelector('#admin-config').addEventListener('click', async event => { const key = event.target.dataset.save; if (!key) return; const input = document.querySelector(`[data-config="${CSS.escape(key)}"]`); try { await adminApi(`/api/v1/admin/config/${encodeURIComponent(key)}`, { method:'PUT', headers:adminHeaders(true), body:JSON.stringify({ value:input.value }) }); toast(`${key} güncellendi.`); } catch (error) { toast(error.message); } });
if (adminKey) loadDashboard().catch(() => { sessionStorage.removeItem('swarm.adminKey'); adminKey = ''; });
