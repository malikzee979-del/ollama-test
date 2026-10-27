/* Ollama Chat service worker (7.16 PWA support).
 *
 * Scope is deliberately minimal, matching the project's local-first posture:
 *   - the app shell (HTML/CSS/JS/fonts/icons) is precached and served
 *     cache-first with a background refresh, so the app opens with no
 *     network at all;
 *   - navigations are network-first (you get the fresh shell when online)
 *     and fall back to the cached shell offline;
 *   - /api/* is NEVER cached or fulfilled from cache — chat traffic must be
 *     genuinely live; the offline experience for chat is the app's own
 *     error banner, not a stale replay;
 *   - non-GET requests are passed straight through.
 *
 * Bump CACHE_VERSION whenever the shell file list or strategy changes so
 * old caches are purged on activate.
 */
'use strict';

const CACHE_VERSION = 'ollama-chat-shell-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/signup.html',
  '/style.css',
  '/app.js',
  '/auth.js',
  '/chat-helpers.js',
  '/fonts/ibm-plex-sans-400.woff2',
  '/fonts/ibm-plex-mono-500.woff2',
  '/icon.svg',
  '/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only same-origin GETs are cacheable; everything else passes through.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Chat/API traffic is never served from cache — live only.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first, cached page as the offline fallback. A
  // successful navigation is cached under its OWN URL — except the app's
  // entry ('/' and '/index.html'), both cached under '/' so they share one
  // entry. The offline fallback then serves the exact page that was cached,
  // falling back to the app shell for any page never visited online.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            const key = (url.pathname === '/' || url.pathname === '/index.html') ? '/' : req.url;
            caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req.url)
            .then((hit) => hit || caches.match('/').then((h) => h || caches.match('/index.html')))
        )
    );
    return;
  }

  // Static shell assets: cache-first with a background refresh.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
