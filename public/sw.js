const CACHE_VERSION = 'flow-pwa-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/pwa-icon-maskable.svg',
  '/offline.html'
];

async function collectAssetsFromHtml() {
  try {
    const response = await fetch('/index.html', { cache: 'no-store' });
    const html = await response.text();
    const matches = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)];
    const sameOriginAssets = matches
      .map((match) => match[1])
      .filter((url) => url.startsWith('/') && !url.startsWith('//') && !url.includes('://'));
    return [...new Set(sameOriginAssets)];
  } catch {
    return [];
  }
}

async function warmCache(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch {
        // Ignore a single asset failure to keep installation resilient.
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const htmlAssets = await collectAssetsFromHtml();
    await warmCache(APP_SHELL_CACHE, [...new Set([...APP_SHELL_FILES, ...htmlAssets])]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Navigation: network first, offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          const shellPage = await caches.match('/index.html');
          const offlinePage = await caches.match('/offline.html');
          return cachedPage || shellPage || offlinePage;
        })
    );
    return;
  }

  // Static same-origin assets: stale while revalidate.
  if (
    url.origin === self.location.origin &&
    ['script', 'style', 'image', 'font'].includes(request.destination)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
  }
});
