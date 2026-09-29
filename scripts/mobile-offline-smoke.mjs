const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9233';
const appUrl = process.env.TEST_URL ?? 'http://127.0.0.1:5098/index.html?offline=1';
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(appUrl)}`, { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const errors = [];
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.text || 'JavaScript exception');
  if (!message.id || !pending.has(message.id)) return;
  const callbacks = pending.get(message.id); pending.delete(message.id);
  message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
});
function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function value(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

await command('Page.enable');
await command('Runtime.enable');
await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await command('Page.reload', { ignoreCache: true });
await wait(900);
const homeNav = await value(`(() => { const nav=document.querySelector('.mobile-bottom-nav'); return { labels:[...nav.querySelectorAll('a')].map(item=>item.textContent.trim()), grid:getComputedStyle(nav).gridTemplateColumns, width:nav.getBoundingClientRect().width, links:[...nav.querySelectorAll('a')].map(item=>({left:item.getBoundingClientRect().left,right:item.getBoundingClientRect().right,width:item.getBoundingClientRect().width}))}; })()`);
await value(`window.SwarmOffline.request('/api/v1/store/purchase',{method:'POST',body:JSON.stringify({itemId:'neon'})}).then(()=>true)`);
await command('Page.reload', { ignoreCache: true });
await wait(500);
const cosmeticPersisted = await value(`window.SwarmOffline.read().owned.includes('neon')`);
await command('Runtime.evaluate', { expression: `document.querySelector('#nickname').value='TestNova';document.querySelector('#login-form').requestSubmit()` });
await wait(1800);
const gameBefore = await value(`(() => { const id=window.SwarmRuntime.session.get('swarm.playerId'); const player=snapshot.players.find(item=>item.id===id); const abilities=[...document.querySelectorAll('.ability-bar button')].map(item=>item.getBoundingClientRect()); return {href:location.href,title:document.title,connection:document.querySelector('#connection')?.textContent,x:player?.position.x,y:player?.position.y,players:snapshot.players.length,energy:snapshot.energy.length,activeTab:document.querySelector('.mobile-bottom-nav a.active')?.dataset.tab,stickVisible:getComputedStyle(document.querySelector('.mobile-stick')).display!=='none',abilitiesVertical:abilities.every((rect,index)=>index===0||(Math.abs(rect.left-abilities[0].left)<2&&rect.top>abilities[index-1].top))}; })()`);
await command('Runtime.evaluate', { expression: `input={x:1,y:0};sendInput()` });
await wait(700);
const movedX = await value(`snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId'))?.position.x`);
await command('Runtime.evaluate', { expression: `input={x:0,y:0};sendInput();location.href=window.SwarmRuntime.homeUrl` });
await wait(900);
await command('Runtime.evaluate', { expression: `document.querySelector('a[href="/portal.html"]').click()` });
await wait(900);
const portal = await value(`({href:location.href,title:document.title,name:document.querySelector('#portal-name')?.textContent,coins:document.querySelector('#portal-coins')?.textContent,activeTab:document.querySelector('.mobile-bottom-nav a.active')?.dataset.tab,topNavHidden:getComputedStyle(document.querySelector('.portal-head nav')).display==='none'})`);
await command('Runtime.evaluate', { expression: `location.href=window.SwarmRuntime.page('./privacy.html')` });
await wait(500);
const privacyTitle = await value('document.title');
await command('Runtime.evaluate', { expression: `document.querySelector('a[href="/support.html"]').click()` });
await wait(500);
const supportTitle = await value('document.title');

const report = {
  homeNav,
  cosmeticPersisted,
  gameBefore,
  movedPixels: Math.round((movedX - gameBefore.x) * 10) / 10,
  portal,
  privacyTitle,
  supportTitle,
  errors,
  passed: homeNav.labels.length === 4 && homeNav.links.every(item => item.left >= 0 && item.right <= 390) && cosmeticPersisted && gameBefore.connection === 'CİHAZ İÇİ TEST' && gameBefore.activeTab === 'play' && gameBefore.stickVisible && gameBefore.abilitiesVertical && movedX > gameBefore.x + 40 && portal.name === 'TestNova' && portal.activeTab === 'progress' && portal.topNavHidden && privacyTitle.includes('Gizlilik') && supportTitle.includes('Destek') && errors.length === 0
};
console.log(JSON.stringify(report));
socket.close();
if (!report.passed) process.exitCode = 1;
