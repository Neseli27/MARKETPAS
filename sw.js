var CACHE = 'marketpas-v8.1';
var ASSETS = ['/musteri.html','/musteri.css','/musteri.js','/yonetim.html','/yonetim.css','/yonetim.js','/kasiyer.html','/kasiyer.css','/kasiyer.js','/firebase-config.js','/manifest-yonetim.json','/icon-192.png','/icon-512.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('firestore') > -1 || e.request.url.indexOf('firebase') > -1 || e.request.url.indexOf('googleapis') > -1) return;
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response.ok) { var clone = response.clone(); caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); }); }
      return response;
    }).catch(function() { return caches.match(e.request); })
  );
});

self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'MarketPas', {
    body: data.body || 'Sıranız geldi!', icon: '/icon-192.png', badge: '/icon-192.png',
    vibrate: [200,100,200,100,200], tag: 'marketpas-queue', requireInteraction: true, data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function(list) {
    if (list.length) { list[0].focus(); return; }
    clients.openWindow(e.notification.data && e.notification.data.url ? e.notification.data.url : '/');
  }));
});
