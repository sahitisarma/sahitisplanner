// Offline support: the planner opens even without a connection.
// Bump VERSION when you publish changes so iPads pick up the new files.
const VERSION = 'sp-v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './css/fonts.css',
  './js/app.js', './js/store.js', './js/model.js', './js/dates.js', './js/ui.js', './js/ink.js', './js/dock.js',
  './js/bus.js', './js/organize.js', './js/google.js', './js/events.js', './js/queue.js', './js/sync.js',
  './js/views/items.js', './js/views/inkpad.js', './js/views/calendar.js', './js/views/lists.js', './js/views/notes.js',
  './js/views/voice.js', './js/views/capture.js', './js/views/everything.js', './js/views/section.js', './js/views/settings.js', './js/views/checklist.js', './js/colorpicker.js',
  './icons/icon.svg', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/playfair-display-latin-wght-normal.woff2', './fonts/playfair-display-latin-wght-italic.woff2', './fonts/inter-latin-wght-normal.woff2', './fonts/bodoni-moda-latin-wght-normal.woff2', './fonts/bodoni-moda-latin-wght-italic.woff2', './fonts/bagel-fat-one-latin-400-normal.woff2', './fonts/caveat-latin-wght-normal.woff2', './fonts/dm-sans-latin-wght-italic.woff2', './fonts/dm-sans-latin-wght-normal.woff2', './fonts/dm-serif-display-latin-400-italic.woff2', './fonts/dm-serif-display-latin-400-normal.woff2', './fonts/fraunces-latin-wght-italic.woff2', './fonts/fraunces-latin-wght-normal.woff2', './fonts/gaegu-latin-400-normal.woff2', './fonts/gaegu-latin-700-normal.woff2', './fonts/gloock-latin-400-normal.woff2', './fonts/kalam-latin-400-normal.woff2', './fonts/kalam-latin-700-normal.woff2', './fonts/outfit-latin-wght-normal.woff2', './fonts/patrick-hand-latin-400-normal.woff2', './fonts/shrikhand-latin-400-normal.woff2', './fonts/space-grotesk-latin-wght-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !k.startsWith('sp-fonts')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Fonts: cache forever once loaded
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.open('sp-fonts').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // Google APIs go straight to the network
  // App files: network first (so updates arrive), cache as fallback (offline)
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
