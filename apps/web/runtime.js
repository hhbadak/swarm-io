(function () {
  const forcedOffline = new URLSearchParams(location.search).get('offline') === '1';
  const native = forcedOffline || location.protocol === 'capacitor:' || location.protocol === 'ionic:' || Boolean(window.Capacitor?.isNativePlatform?.());
  const configuredOrigin = localStorage.getItem('swarm.apiOrigin') || 'https://swarm-io.onrender.com';
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
      try {
        const response = await fetch(this.apiUrl(path), options);
        if (response.ok || !native || ![404, 502, 503, 504].includes(response.status)) return response;
      } catch (error) {
        if (!native) throw error;
      }
      if (!window.SwarmOffline) throw new Error('Sunucuya ulaşılamıyor.');
      this.offline = true;
      return window.SwarmOffline.request(path, options);
    },
    page,
    homeUrl: native ? page('./index.html') : '/',
    gameUrl: native ? page('./game.html') : '/game.html'
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
