'use strict';

// Keeps Gulzar usable on a weak connection. Page code is network-first (an update shows on the next
// launch); pictures and fonts never change, so they come from the cache once fetched. Only this site's
// own files are handled.
const CACHE = 'gulzar-v3';
const SHELL = ['./', 'index.html', 'style.css', 'content.js', 'app.js', 'icon.svg', 'icon-mono.svg', 'manifest.webmanifest', 'fonts/atkinson-latin.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const lasting = /\/(img|fonts)\//.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (lasting) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    }
    try {
      const response = await Promise.race([
        fetch(event.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), 3000)),
      ]);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch (e) {
      return (await cache.match(event.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
