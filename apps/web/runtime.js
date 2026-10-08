(function () {
  const forcedOffline = new URLSearchParams(location.search).get('offline') === '1';
  const native = forcedOffline || location.protocol === 'capacitor:' || location.protocol === 'ionic:' || Boolean(window.Capacitor?.isNativePlatform?.());
  const configuredOrigin = localStorage.getItem('swarm.apiOrigin') || 'https://swarm-io-live.hsnhsynesk.workers.dev';
  const apiOrigin = native ? configuredOrigin.replace(/\/$/, '') : '';

  function page(name) {
    const url = new URL(name, location.href);
    if (forcedOffline) url.searchParams.set('offline', '1');
    return url.href;
  }

  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function canRetry(path, options) {
    const method = String(options.method || 'GET').toUpperCase();
    return method === 'GET'
      || method === 'HEAD'
      || path.startsWith('/api/v1/auth/guest')
      || path.startsWith('/api/v1/matchmaking/queue');
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
      const retryDelays = canRetry(path, options) ? [0, 1200, 2500, 5000, 9000] : [0];
      let lastError;
      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        if (retryDelays[attempt]) await wait(retryDelays[attempt]);
        try {
          const response = await fetch(this.apiUrl(path), options);
          if (![408, 425, 429, 502, 503, 504].includes(response.status) || attempt === retryDelays.length - 1) return response;
          lastError = new Error(`Sunucu geçici olarak hazır değil (${response.status}).`);
        } catch (error) {
          lastError = error;
          if (attempt === retryDelays.length - 1) break;
        }
        dispatchEvent(new CustomEvent('swarm:network-retry', { detail: { attempt: attempt + 1, path } }));
      }
      if (lastError) console.warn('SWARM.IO bağlantısı kurulamadı:', lastError.message);
      throw new Error('Sunucu uyanıyor. Lütfen birkaç saniye sonra tekrar dene.');
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
