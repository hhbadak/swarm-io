const form = document.querySelector('#login-form');
const statusNode = document.querySelector('#status');
const nicknameInput = document.querySelector('#nickname');
const cosmeticsPanel = document.querySelector('#cosmetics');
const catalogGrid = document.querySelector('#catalog-grid');
const previewCanvas = document.querySelector('#character-preview');
let catalog = [];
let owned = new Set(['starter']);
let equipped = 'starter';
let selected = 'starter';
let activeFilter = 'all';
let profile;
let paymentOffers = [];
let createdRoomCode = '';

addEventListener('swarm:network-retry', () => {
  statusNode.textContent = 'Ücretsiz sunucu uyanıyor… Bağlantı otomatik yeniden deneniyor.';
});

function token() { return window.SwarmRuntime.session.get('swarm.accessToken'); }
function authHeaders(json = false) { return { ...(json ? { 'content-type': 'application/json' } : {}), ...(token() ? { authorization: `Bearer ${token()}` } : {}) }; }
function deviceId() {
  let value = localStorage.getItem('swarm.deviceId');
  if (!value) { value = crypto.randomUUID(); localStorage.setItem('swarm.deviceId', value); }
  return value;
}

async function api(path, options = {}) {
  const response = await window.SwarmRuntime.request(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `İşlem başarısız (${response.status})`);
  return data;
}

async function createSession() {
  const session = await api('/api/v1/auth/guest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), nickname: nicknameInput.value })
  });
  window.SwarmRuntime.session.set('swarm.accessToken', session.accessToken);
  window.SwarmRuntime.session.set('swarm.playerId', session.player.id);
  profile = session.player;
  await loadInventory();
  updateProfile();
  return session;
}

async function ensureSession() {
  if (!token()) return createSession();
  try {
    profile = await api('/api/v1/profile', { headers: authHeaders() });
    nicknameInput.value = profile.nickname;
    await loadInventory();
    updateProfile();
    return { player: profile, accessToken: token() };
  } catch {
    window.SwarmRuntime.session.remove('swarm.accessToken');
    return createSession();
  }
}

async function loadInventory() {
  const data = await api('/api/v1/inventory', { headers: authHeaders() });
  owned = new Set(data.items.map(item => item.itemId));
  owned.add('starter');
  equipped = data.items.find(item => item.isEquipped)?.itemId || profile?.equippedSkin || 'starter';
  selected = equipped;
}

function updateProfile() {
  document.querySelector('#coin-balance').textContent = (profile?.coins ?? 0).toLocaleString('tr-TR');
  document.querySelector('#gem-balance').textContent = (profile?.gems ?? 0).toLocaleString('tr-TR');
  document.querySelector('#cosmetics-coins').textContent = (profile?.coins ?? 0).toLocaleString('tr-TR');
  document.querySelector('#cosmetics-gems').textContent = (profile?.gems ?? 0).toLocaleString('tr-TR');
  document.querySelector('#profile-state').textContent = profile ? 'HAZIR' : 'MİSAFİR';
  document.querySelector('#equipped-name').textContent = itemById(equipped)?.name ?? 'Starter Core';
  selectItem(selected);
}

function itemById(id) { return catalog.find(item => item.id === id) || catalog[0]; }
function selectItem(id) {
  selected = id;
  const item = itemById(id);
  if (!item) return;
  document.querySelector('#selected-name').textContent = item.name;
  document.querySelector('#selected-rarity').textContent = item.rarity.toUpperCase();
  document.querySelector('#selected-description').textContent = `${item.traitName} · ${item.traitDescription}`;
  document.querySelectorAll('.skin-card').forEach(card => card.classList.toggle('selected', card.dataset.id === id));
}

function priceLabel(item) {
  if (!item.price) return 'ÜCRETSİZ';
  return `${item.currency === 'Gems' ? '◆' : '●'} ${item.price.toLocaleString('tr-TR')}`;
}

function actionLabel(item) {
  if (equipped === item.id) return 'KUŞANILDI';
  if (owned.has(item.id)) return 'KUŞAN';
  return `${priceLabel(item)} · SATIN AL`;
}

function renderCatalog() {
  const items = catalog.filter(item => activeFilter === 'all' || activeFilter === 'owned' && owned.has(item.id) || activeFilter === 'coins' && item.currency === 'Coins' || activeFilter === 'gems' && item.currency === 'Gems');
  catalogGrid.innerHTML = items.map(item => {
    const isOwned = owned.has(item.id), isEquipped = equipped === item.id;
    return `<article class="skin-card ${selected === item.id ? 'selected' : ''} ${isEquipped ? 'equipped' : ''}" data-id="${item.id}">
      <div class="skin-preview"><canvas width="360" height="220" data-skin="${item.id}"></canvas><span class="skin-state">${isEquipped ? 'KUŞANILDI' : isOwned ? 'SAHİPSİN' : item.rarity.toUpperCase()}</span></div>
      <div class="skin-info"><div><small>${item.rarity.toUpperCase()}</small><b>${item.name}</b></div><span class="price ${item.currency === 'Gems' ? 'gem' : ''}">${priceLabel(item)}</span><p>${item.description}</p><div class="skin-trait"><b>${item.traitName}</b><span>${item.traitDescription}</span></div><button type="button" class="${isOwned ? '' : 'buy'}" data-action="${isOwned ? 'equip' : 'buy'}" ${isEquipped ? 'disabled' : ''}>${actionLabel(item)}</button></div>
    </article>`;
  }).join('');
}

function renderPaymentOffers() {
  const host = document.querySelector('#gem-offers');
  host.innerHTML = paymentOffers.map(offer => {
    const nativeProduct = window.SwarmPurchases?.product(offer);
    const available = window.SwarmRuntime.native ? Boolean(nativeProduct) && !window.SwarmRuntime.offline : offer.webAvailable;
    const price = window.SwarmRuntime.native ? nativeProduct?.displayPrice : offer.webPriceLabel;
    const unavailableLabel = window.SwarmRuntime.native && window.SwarmRuntime.offline ? 'TEST SÜRÜMÜNDE KAPALI' : 'YAKINDA';
    return `<button class="gem-offer" type="button" data-offer="${offer.id}" ${available ? '' : 'disabled'}><b>◆ ${offer.gems.toLocaleString('tr-TR')}</b><small>${offer.bonusLabel || 'KRİSTAL'}</small><strong>${available ? price : unavailableLabel}</strong></button>`;
  }).join('');
}

async function startWebCheckout(offerId) {
  statusNode.textContent = 'Güvenli ödeme sayfası hazırlanıyor…';
  try {
    await ensureSession();
    const checkout = await api('/api/v1/store/web-checkout', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ offerId }) });
    location.href = checkout.url;
  } catch (error) { statusNode.textContent = error.message; }
}

async function startNativeCheckout(offerId) {
  statusNode.textContent = 'App Store satın alma ekranı hazırlanıyor…';
  try {
    if (window.SwarmRuntime.offline) throw new Error('Satın alma için canlı sunucu bağlantısı gerekiyor.');
    await ensureSession();
    const offer = paymentOffers.find(item => item.id === offerId);
    if (!offer) throw new Error('Kristal paketi bulunamadı.');
    const result = await window.SwarmPurchases.purchase(offer, token());
    profile.gems = result.gems;
    updateProfile();
    statusNode.textContent = `${offer.gems.toLocaleString('tr-TR')} kristal hesabına eklendi.`;
  } catch (error) { statusNode.textContent = error.message; }
}

async function performAction(itemId, action) {
  statusNode.textContent = action === 'buy' ? 'Satın alma hazırlanıyor…' : 'Karakter kuşanılıyor…';
  try {
    await ensureSession();
    if (action === 'buy') {
      const result = await api('/api/v1/store/purchase', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ itemId }) });
      profile.coins = result.coins; profile.gems = result.gems; owned.add(itemId);
    }
    await api('/api/v1/inventory/equip', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ itemId }) });
    equipped = itemId; selected = itemId;
    statusNode.textContent = `${itemById(itemId).name} kuşanıldı.`;
    updateProfile(); renderCatalog();
  } catch (error) {
    const messages = { INSUFFICIENT_FUNDS: 'Yeterli bakiyen yok.', ALREADY_OWNED: 'Bu karakter zaten sende.', NOT_OWNED: 'Önce bu karakteri almalısın.' };
    statusNode.textContent = messages[error.message] || error.message;
  }
}

function openCosmetics(mode) {
  cosmeticsPanel.hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelector('#cosmetics-kicker').textContent = mode === 'store' ? 'MAĞAZA' : 'KOLEKSİYON';
  window.SwarmMobileNav?.setActive(mode === 'store' ? 'store' : 'collection');
  activeFilter = mode === 'collection' ? 'owned' : 'all';
  document.querySelectorAll('.catalog-tabs button').forEach(button => button.classList.toggle('active', button.dataset.filter === activeFilter));
  renderCatalog();
}
function closeCosmetics() {
  cosmeticsPanel.hidden = true;
  document.body.style.overflow = '';
  window.SwarmMobileNav?.setActive('play');
  if (location.search) history.replaceState(null, '', location.pathname);
}

function gameUrl(mode = 'public', roomCode = '') {
  const url = new URL(window.SwarmRuntime.gameUrl, location.href);
  url.searchParams.set('mode', mode);
  if (roomCode) url.searchParams.set('room', roomCode);
  return url.href;
}

async function enterArena(mode = 'public', roomCode = '') {
  const normalizedCode = roomCode.trim().toUpperCase();
  if (mode === 'private' && !/^SW-[A-Z0-9]{4}$/.test(normalizedCode)) throw new Error('Oda kodu SW-XXXX biçiminde olmalı.');
  await createSession();
  location.href = gameUrl(mode, normalizedCode);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button'); button.disabled = true; statusNode.textContent = 'Avcı profili hazırlanıyor…';
  try { await enterArena('public'); }
  catch (error) { statusNode.textContent = error.message; button.disabled = false; }
});
document.querySelector('#create-room').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; statusNode.textContent = 'Arkadaş odası hazırlanıyor…';
  try {
    await createSession();
    const result = await api('/api/v1/matchmaking/rooms', { method: 'POST', headers: authHeaders() });
    createdRoomCode = result.roomCode;
    const panel = document.querySelector('#room-created'); panel.hidden = false;
    document.querySelector('#copy-room-code').textContent = createdRoomCode;
    statusNode.textContent = 'Oda hazır. Kodu paylaş, sonra odaya gir.';
  } catch (error) { statusNode.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#copy-room-code').addEventListener('click', async () => {
  if (!createdRoomCode) return;
  try { await navigator.clipboard.writeText(createdRoomCode); statusNode.textContent = `${createdRoomCode} panoya kopyalandı.`; }
  catch { statusNode.textContent = `Oda kodun: ${createdRoomCode}`; }
});
document.querySelector('#enter-created-room').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await enterArena('private', createdRoomCode); }
  catch (error) { statusNode.textContent = error.message; button.disabled = false; }
});
document.querySelector('#join-room').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; statusNode.textContent = 'Arkadaş odasına bağlanılıyor…';
  try { await enterArena('private', document.querySelector('#room-code').value); }
  catch (error) { statusNode.textContent = error.message === 'ROOM_NOT_FOUND' ? 'Bu oda bulunamadı veya kodun süresi doldu.' : error.message; button.disabled = false; }
});
document.querySelector('#room-code').addEventListener('input', event => {
  let value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (value.startsWith('SW')) value = value.slice(2);
  event.target.value = value ? `SW-${value.slice(0, 4)}` : '';
});
document.querySelectorAll('button.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('button.nav-item').forEach(item => item.classList.toggle('active', item === button));
  if (button.dataset.view !== 'play') openCosmetics(button.dataset.view);
}));
document.querySelector('#open-collection').addEventListener('click', () => openCosmetics('collection'));
document.querySelector('#delete-account').addEventListener('click', async () => {
  if (!token()) return statusNode.textContent = 'Silinecek kayıtlı bir profil bulunmuyor.';
  if (!confirm('Profilin, ilerlemen, kozmetiklerin ve oyun geçmişin kalıcı olarak silinecek. Devam edilsin mi?')) return;
  try {
    const response = await window.SwarmRuntime.request('/api/v1/profile', { method: 'DELETE', headers: authHeaders() });
    if (!response.ok && response.status !== 204) throw new Error('Hesap silinemedi.');
    window.SwarmRuntime.session.remove('swarm.accessToken');
    window.SwarmRuntime.session.remove('swarm.playerId');
    localStorage.removeItem('swarm.deviceId');
    profile = null; owned = new Set(['starter']); equipped = 'starter'; selected = 'starter';
    nicknameInput.value = 'Nova'; updateProfile(); renderCatalog();
    statusNode.textContent = 'Hesabın ve ilişkili oyun verilerin kalıcı olarak silindi.';
  } catch (error) { statusNode.textContent = error.message; }
});
document.querySelector('#close-cosmetics').addEventListener('click', closeCosmetics);
cosmeticsPanel.addEventListener('click', event => { if (event.target === cosmeticsPanel) closeCosmetics(); });
document.querySelectorAll('.catalog-tabs button').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('.catalog-tabs button').forEach(item => item.classList.toggle('active', item === button)); renderCatalog(); }));
catalogGrid.addEventListener('click', event => {
  const card = event.target.closest('.skin-card'); if (!card) return; selectItem(card.dataset.id);
  const action = event.target.closest('[data-action]'); if (action) performAction(card.dataset.id, action.dataset.action);
});
document.querySelector('#gem-offers').addEventListener('click', event => {
  const button = event.target.closest('[data-offer]');
  if (button) (window.SwarmRuntime.native ? startNativeCheckout : startWebCheckout)(button.dataset.offer);
});
addEventListener('keydown', event => { if (event.key === 'Escape') closeCosmetics(); });

function drawPreviews(time) {
  const renderer = window.SwarmCharacters;
  if (renderer) {
    const ctx = previewCanvas.getContext('2d'); ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    renderer.drawCharacter(ctx, { x: 300, y: 305, radius: 128, skinId: selected, time });
    document.querySelectorAll('.skin-preview canvas').forEach(canvas => {
      const cardCtx = canvas.getContext('2d'); cardCtx.clearRect(0, 0, canvas.width, canvas.height);
      renderer.drawCharacter(cardCtx, { x: canvas.width / 2, y: canvas.height / 2, radius: 56, skinId: canvas.dataset.skin, time });
    });
  }
  requestAnimationFrame(drawPreviews);
}

async function start() {
  try {
    const health = await window.SwarmRuntime.request('/health/live'); if (!health.ok) throw new Error();
    [catalog, paymentOffers] = await Promise.all([api('/api/v1/store/catalog'), api('/api/v1/store/offers')]);
    if (window.SwarmRuntime.native) {
      try { await window.SwarmPurchases.loadProducts(paymentOffers); }
      catch { /* StoreKit ürünleri hazır değilse oyun ve gezinme çalışmaya devam eder. */ }
    }
    renderPaymentOffers();
    selectItem('starter');
    if (token()) { await ensureSession(); statusNode.textContent = 'Profil hazır. Arenaya girebilirsin.'; }
    else { updateProfile(); statusNode.textContent = 'Sunucu hazır. Arenaya girebilirsin.'; }
    if (window.SwarmRuntime.offline) statusNode.textContent = 'Çevrimdışı test modu hazır. Arenaya girebilirsin.';
    const requestedView = new URLSearchParams(location.search).get('view');
    if (requestedView === 'collection' || requestedView === 'store') openCosmetics(requestedView);
  } catch { statusNode.textContent = 'Sunucuya ulaşılamıyor.'; }
  requestAnimationFrame(drawPreviews);
}
start();
if (!window.SwarmRuntime.native && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
