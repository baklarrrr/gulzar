'use strict';

// Keeps Gulzar usable on a weak connection. The two page shells (index.html and draw.html) open from the cache
// at once and refresh in the background, so moving to the drawing page never waits on the network. Page code
// (scripts and styles) is network-first with a short wait. Pictures and fonts never change, so they come from
// the cache once fetched. Only this site's own files are handled.
const CACHE = 'gulzar-v6';
const SHELL = ['./', 'index.html', 'draw.html', 'style.css', 'content.js', 'app.js', 'icon.svg', 'icon-mono.svg', 'manifest.webmanifest', 'fonts/atkinson-latin.woff2'];

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
  const shell = event.request.mode === 'navigate' || /(\/|\.html)$/.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (shell) {
      const hit = await cache.match(event.request, { ignoreSearch: true });
      const fresh = fetch(event.request).then((response) => {
        if (response.ok) cache.put(new Request(url.origin + url.pathname), response.clone());
        return response;
      });
      if (hit) {
        event.waitUntil(fresh.catch(() => {}));
        return hit;
      }
      try {
        return await fresh;
      } catch (e) {
        return Response.error();
      }
    }
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
