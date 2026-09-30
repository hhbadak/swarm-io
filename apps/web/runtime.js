(function () {
  const forcedOffline = new URLSearchParams(location.search).get('offline') === '1';
  const native = forcedOffline || location.protocol === 'capacitor:' || location.protocol === 'ionic:' || Boolean(window.Capacitor?.isNativePlatform?.());
  const configuredOrigin = localStorage.getItem('swarm.apiOrigin') || 'https://swarm-io-api.onrender.com';
  const apiOrigin = native ? configuredOrigin.replace(/\/$/, '') : '';

  function page(name) {
    const url = new URL(name, location.href);
    if (forcedOffline) url.searchParams.set('offline', '1');
    return url.href;
  }

  window.SwarmRuntime = {
    native,
    platform: native ? 'ios' : 'web',
    offline: false,
    apiUrl(path) {
      return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
    },
    async request(path, options = {}) {
      if (this.offline && window.SwarmOffline) return window.SwarmOffline.request(path, options);
      return fetch(this.apiUrl(path), options);
    },
    page,
    homeUrl: native ? page('./index.html') : '/',
    gameUrl: native ? page('./game.html') : '/game.html',
    session: {
      get(key) { return sessionStorage.getItem(key) || localStorage.getItem(key); },
      set(key, value) { sessionStorage.setItem(key, value); localStorage.setItem(key, value); },
      remove(key) { sessionStorage.removeItem(key); localStorage.removeItem(key); }
    }
  };
  if (forcedOffline) window.SwarmRuntime.offline = true;

  if (native) addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!href?.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    location.href = page(`.${href === '/' ? '/index.html' : href}`);
  });
})();
