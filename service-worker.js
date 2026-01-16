/**
 * Chromezone Self-Service Kiosk - Service Worker
 * Provides offline functionality through caching
 * 
 * Strategy: Cache-first for app shell, Network-first for dynamic content
 */

const CACHE_NAME = 'chromezone-v1.0.0';

// Files to cache for offline use
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './flows.json',
  './config.json',
  './manifest.json'
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Activate immediately, don't wait for old SW to finish
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache install failed:', error);
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event - serve from cache, fall back to network
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // For navigation requests, serve index.html (SPA behavior)
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then((response) => response || fetch(request))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then((networkResponse) => {
            // Don't cache non-successful responses
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Cache successful responses for static files
            if (isStaticAsset(request.url)) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseToCache);
                });
            }

            return networkResponse;
          })
          .catch((error) => {
            console.error('[SW] Fetch failed:', error);
            // Return a fallback for HTML requests
            if (request.headers.get('Accept').includes('text/html')) {
              return caches.match('./index.html');
            }
            throw error;
          });
      })
  );
});

/**
 * Check if URL is a static asset that should be cached
 */
function isStaticAsset(url) {
  const staticExtensions = ['.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.ico'];
  return staticExtensions.some(ext => url.endsWith(ext));
}

/**
 * Handle messages from the main app
 */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME)
      .then(() => {
        console.log('[SW] Cache cleared');
        event.ports[0].postMessage('Cache cleared');
      });
  }
});
