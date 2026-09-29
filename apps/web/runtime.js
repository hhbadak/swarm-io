(function () {
  const native = location.protocol === 'capacitor:' || location.protocol === 'ionic:';
  const configuredOrigin = localStorage.getItem('swarm.apiOrigin') || 'https://swarm-io.onrender.com';
  const apiOrigin = native ? configuredOrigin.replace(/\/$/, '') : '';

  window.SwarmRuntime = {
    native,
    platform: native ? 'ios' : 'web',
    apiUrl(path) {
      return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
    },
    homeUrl: native ? '/index.html' : '/',
    gameUrl: '/game.html'
  };
})();
