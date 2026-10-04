const CACHE = 'swarm-shell-v12';
const SHELL = ['/', '/index.html', '/game.html', '/portal.html', '/privacy.html', '/terms.html', '/support.html', '/styles.css', '/mobile-shell.css', '/lobby.css', '/game.css', '/portal.css', '/legal.css', '/bootstrap.js', '/runtime.js', '/offline-api.js', '/mobile-shell.js', '/native-purchases.js', '/app.js', '/game.js', '/portal.js', '/character-renderer.js', '/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('/ws/')) return;
  event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request)));
});
