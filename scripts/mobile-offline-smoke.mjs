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
await value(`window.SwarmOffline.request('/api/v1/inventory/equip',{method:'POST',body:JSON.stringify({itemId:'neon'})}).then(()=>true)`);
await command('Page.reload', { ignoreCache: true });
await wait(500);
const cosmeticPersisted = await value(`window.SwarmOffline.read().owned.includes('neon')`);
await command('Runtime.evaluate', { expression: `openCosmetics('store')` });
await wait(120);
const collectionBalance = await value(`(() => { const wallet=document.querySelector('.cosmetics-balance'); const rect=wallet.getBoundingClientRect(); const target=document.querySelector('.skin-card b'); const contextEvent=new Event('contextmenu',{bubbles:true,cancelable:true}); const selectionEvent=new Event('selectstart',{bubbles:true,cancelable:true}); return {coins:document.querySelector('#cosmetics-coins')?.textContent,label:wallet.textContent,visible:getComputedStyle(wallet).display!=='none',inside:rect.left>=0&&rect.right<=innerWidth,traits:[...document.querySelectorAll('.skin-trait>b')].map(item=>item.textContent),userSelect:getComputedStyle(target).userSelect,contextPrevented:!target.dispatchEvent(contextEvent),selectionPrevented:!target.dispatchEvent(selectionEvent),inputSelect:getComputedStyle(document.querySelector('#nickname')).userSelect}; })()`);
await command('Runtime.evaluate', { expression: `closeCosmetics()` });
await command('Runtime.evaluate', { expression: `document.querySelector('#nickname').value='TestNova';document.querySelector('#login-form').requestSubmit()` });
await wait(1800);
const gameBefore = await value(`(() => { const id=window.SwarmRuntime.session.get('swarm.playerId'); const player=snapshot.players.find(item=>item.id===id); const abilities=[...document.querySelectorAll('.ability-bar button')].map(item=>item.getBoundingClientRect()); const nav=document.querySelector('.mobile-bottom-nav'); const stick=document.querySelector('.mobile-stick'); const stickRect=stick.getBoundingClientRect(); return {href:location.href,title:document.title,connection:document.querySelector('#connection')?.textContent,x:player?.position.x,y:player?.position.y,players:snapshot.players.length,energy:snapshot.energy.length,skinId:player?.skinId,trait:traitFor(player),gameNavHidden:!nav||getComputedStyle(nav).display==='none',brandInteractive:document.querySelector('.hud a')!==null,stickVisible:getComputedStyle(stick).display!=='none',stickCentered:Math.abs((stickRect.left+stickRect.width/2)-innerWidth/2)<2,stickBottomRatio:(innerHeight-stickRect.bottom)/innerHeight,abilitiesVertical:abilities.every((rect,index)=>index===0||(Math.abs(rect.left-abilities[0].left)<2&&rect.top>abilities[index-1].top))}; })()`);
await command('Runtime.evaluate', { expression: `input={x:1,y:0};sendInput()` });
await wait(700);
const movedX = await value(`snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId'))?.position.x`);
await command('Runtime.evaluate', { expression: `input={x:0,y:0};sendInput();document.querySelector('#shield').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:21,pointerType:'touch'}));document.querySelector('#magnet').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:22,pointerType:'touch'}))` });
await wait(120);
const abilitiesActive = await value(`(() => { const own=snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId')); return {shield:own.shieldActive,magnet:own.magnetActive,shieldCooling:document.querySelector('#shield').disabled,magnetCooling:document.querySelector('#magnet').disabled}; })()`);
const dashStart = await value(`snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId'))?.position.x`);
await command('Runtime.evaluate', { expression: `document.querySelector('#dash').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:23,pointerType:'touch'}))` });
await wait(430);
const dashEnd = await value(`snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId'))?.position.x`);
await command('Runtime.evaluate', { expression: `(() => { const own=snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId')); own.score=0;own.radius=22;own.position.x=own.radius;own.magnetUntil=0;own.magnetActive=false;snapshot.energy=[];input={x:-1,y:0};boundaryPenaltyReadyAt=0;zeroBoundaryStrikes=0;sendInput(); })()` });
await wait(1750);
const boundaryDeath = await value(`(() => { const own=snapshot.players.find(item=>item.id===sessionStorage.getItem('swarm.playerId')); return {alive:own.alive,gameOver:!document.querySelector('#game-over').hidden}; })()`);
await command('Runtime.evaluate', { expression: `location.href=window.SwarmRuntime.homeUrl` });
await wait(900);
await command('Runtime.evaluate', { expression: `document.querySelector('a[href="/portal.html"]').click()` });
await wait(900);
const portal = await value(`({href:location.href,title:document.title,name:document.querySelector('#portal-name')?.textContent,coins:document.querySelector('#portal-coins')?.textContent,coinLabel:document.querySelector('#portal-coins')?.parentElement?.textContent,activeTab:document.querySelector('.mobile-bottom-nav a.active')?.dataset.tab,topNavHidden:getComputedStyle(document.querySelector('.portal-head nav')).display==='none',scrollable:document.scrollingElement.scrollHeight>innerHeight})`);
await command('Runtime.evaluate', { expression: `scrollTo(0,document.scrollingElement.scrollHeight)` });
await wait(150);
const portalScrolled = await value(`scrollY>0`);
await command('Runtime.evaluate', { expression: `location.href=window.SwarmRuntime.page('./privacy.html')` });
await wait(500);
const privacyTitle = await value('document.title');
const legalPlayTarget = await value(`document.querySelector('.mobile-bottom-nav [data-tab="play"]')?.getAttribute('href')`);
const legalPlayLabel = await value(`document.querySelector('.mobile-bottom-nav [data-tab="play"]')?.textContent.trim()`);
await command('Runtime.evaluate', { expression: `document.querySelector('a[href="/support.html"]').click()` });
await wait(500);
const supportTitle = await value('document.title');

const report = {
  homeNav,
  cosmeticPersisted,
  collectionBalance,
  gameBefore,
  movedPixels: Math.round((movedX - gameBefore.x) * 10) / 10,
  dashPixels: Math.round((dashEnd - dashStart) * 10) / 10,
  abilitiesActive,
  boundaryDeath,
  portal,
  portalScrolled,
  privacyTitle,
  legalPlayTarget,
  legalPlayLabel,
  supportTitle,
  errors,
  passed: homeNav.labels.length === 4 && homeNav.links.every(item => item.left >= 0 && item.right <= 390) && cosmeticPersisted && collectionBalance.visible && collectionBalance.inside && collectionBalance.label.includes('ALTIN') && collectionBalance.traits.length === 6 && collectionBalance.userSelect === 'none' && collectionBalance.contextPrevented && collectionBalance.selectionPrevented && collectionBalance.inputSelect === 'text' && gameBefore.connection === 'CİHAZ İÇİ TEST' && gameBefore.skinId === 'neon' && gameBefore.trait.magnetReach === 1.35 && gameBefore.gameNavHidden && !gameBefore.brandInteractive && gameBefore.stickVisible && gameBefore.stickCentered && gameBefore.stickBottomRatio >= .18 && gameBefore.abilitiesVertical && movedX > gameBefore.x + 40 && dashEnd > dashStart + 40 && abilitiesActive.shield && abilitiesActive.magnet && abilitiesActive.shieldCooling && abilitiesActive.magnetCooling && !boundaryDeath.alive && boundaryDeath.gameOver && portal.name === 'TestNova' && portal.activeTab === 'progress' && portal.topNavHidden && portal.scrollable && portalScrolled && portal.coinLabel.includes('ALTIN') && privacyTitle.includes('Gizlilik') && legalPlayTarget.includes('index.html') && legalPlayLabel.includes('ANA MENÜ') && supportTitle.includes('Destek') && errors.length === 0
};
console.log(JSON.stringify(report));
socket.close();
if (!report.passed) process.exitCode = 1;
