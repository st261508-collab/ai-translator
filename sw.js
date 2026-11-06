'use strict';
const CACHE = 'kotoba-pocket-shell-v1';
const SHELL = ['./', './index.html', './style.css', './script.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kotoba-pocket-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const allowed = SHELL.map(path => new URL(path,self.registration.scope).href);
  if (event.request.mode === 'navigate' && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL('./index.html',self.registration.scope).href))); return;
  }
  if (allowed.includes(url.href)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
