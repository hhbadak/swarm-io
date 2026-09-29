(function () {
  const isNative = location.protocol === 'capacitor:' || location.protocol === 'ionic:' || Boolean(window.Capacitor?.isNativePlatform?.());
  if (isNative) document.documentElement.classList.add('native-shell');

  const preventZoom = event => event.preventDefault();
  document.addEventListener('gesturestart', preventZoom, { passive: false });
  document.addEventListener('gesturechange', preventZoom, { passive: false });
  document.addEventListener('gestureend', preventZoom, { passive: false });
  document.addEventListener('dblclick', preventZoom, { passive: false });

  const isEditable = target => target instanceof Element && Boolean(target.closest('input,textarea,[contenteditable="true"]'));
  document.addEventListener('selectstart', event => { if (!isEditable(event.target)) event.preventDefault(); });
  document.addEventListener('contextmenu', event => { if (!isEditable(event.target)) event.preventDefault(); });
  document.addEventListener('dragstart', event => { if (!isEditable(event.target)) event.preventDefault(); });

  function localPage(path) {
    if (window.SwarmRuntime?.native) return window.SwarmRuntime.page(path);
    return path.replace(/^\.\//, '/');
  }

  const pathname = location.pathname.toLowerCase();
  const isLegalPage = pathname.endsWith('/privacy.html') || pathname.endsWith('/terms.html') || pathname.endsWith('/support.html');
  const requestedView = new URLSearchParams(location.search).get('view');
  let active = pathname.endsWith('/game.html') ? 'play' : pathname.endsWith('/portal.html') ? 'progress' : requestedView === 'collection' || requestedView === 'store' ? requestedView : 'play';

  const nav = document.createElement('nav');
  nav.className = 'mobile-bottom-nav';
  nav.setAttribute('aria-label', 'Uygulama menüsü');
  nav.innerHTML = `
    <a data-tab="play" href="${localPage(isLegalPage ? './index.html' : './game.html')}"><span>${isLegalPage ? '←' : '▶'}</span>${isLegalPage ? 'ANA MENÜ' : 'OYNA'}</a>
    <a data-tab="collection" href="${localPage('./index.html?view=collection')}"><span>◉</span>KOLEKSİYON</a>
    <a data-tab="store" href="${localPage('./index.html?view=store')}"><span>✦</span>MAĞAZA</a>
    <a data-tab="progress" href="${localPage('./portal.html')}"><span>◆</span>İLERLEME</a>`;
  document.body.appendChild(nav);

  function setActive(tab) {
    active = tab;
    nav.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === active));
  }

  setActive(active);
  window.SwarmMobileNav = { setActive };
})();
