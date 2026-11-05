/* Service worker for 3-Piece Cartoon Wood Tic-Tac-Toe
 * Bump CACHE_VERSION whenever you deploy changes so clients pick up the new files. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `tictactoe-${CACHE_VERSION}`;

// Same-origin app shell (relative to the SW scope, so GitHub Pages subpaths work)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Cross-origin dependencies used by index.html
const TAILWIND_URL = 'https://cdn.tailwindcss.com';
const CSS_DEPENDENCIES = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700;900&display=swap'
];

// Fetch a stylesheet (CORS-enabled on these CDNs), cache it, then cache every font file it references.
async function precacheStylesheetWithAssets(cache, cssUrl) {
  const res = await fetch(cssUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${cssUrl}`);
  const cssText = await res.clone().text();
  await cache.put(cssUrl, res);

  const urls = new Set();
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    if (m[2].startsWith('data:')) continue;
    urls.add(new URL(m[2], cssUrl).href);
  }
  await Promise.all([...urls].map(async (u) => {
    try {
      const r = await fetch(u);
      if (r.ok) await cache.put(u, r);
    } catch (e) { /* font will be cached at runtime if it is ever requested */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Local files: required
    await cache.addAll(APP_SHELL);

    // Remote files: best effort, a single failure must not block installation
    const remoteTasks = [
      (async () => {
        const r = await fetch(TAILWIND_URL, { mode: 'no-cors' });
        await cache.put(TAILWIND_URL, r);
      })(),
      ...CSS_DEPENDENCIES.map((u) => precacheStylesheetWithAssets(cache, u))
    ];
    await Promise.allSettled(remoteTasks);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('tictactoe-') && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Page navigations: serve cached page instantly, refresh it in the background
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = (await cache.match(req, { ignoreSearch: true })) ||
                     (await cache.match('./index.html'));
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put('./index.html', res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return (await refresh) || new Response('Offline and not cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    })());
    return;
  }

  // Everything else (local files + CDN assets): cache-first, then network with runtime caching
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache good responses and opaque cross-origin ones (e.g. no-cors script/link loads)
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
