// Service worker: caches the whole app so it opens instantly and works offline (and makes it installable).
// VERSION is replaced with a content hash by Web/deploy.sh — every deploy gets a fresh cache.
const VERSION = '41e6add92d76';
const CACHE = `sruti-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/state.js', 'js/music.js', 'js/storage.js',
  'js/dsp/pitch.js', 'js/dsp/tanpura.js',
  'js/audio/engine.js', 'js/audio/worklet.js', 'js/audio/analysis-worker.js', 'js/audio/wav.js',
  'js/ui/main.js', 'js/ui/graph.js', 'js/ui/menu.js', 'js/ui/sheets.js', 'js/ui/palette.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'demo/test-sarali-1-D3.wav',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sruti-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // In development (VERSION = 'dev') always go to the network, so edits show up on reload.
  if (VERSION === 'dev') return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })).catch(() => caches.match('index.html')));
});
