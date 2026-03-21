// MarketPas v2 Service Worker
const CACHE = 'marketpas-v2';
const ASSETS = [
  '/musteri.html',
  '/musteri.css',
  '/musteri.js',
  '/firebase-config.js',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Firebase ve API isteklerini cache'leme
  if (e.request.url.includes('firestore') || e.request.url.includes('firebase') || e.request.url.includes('googleapis')) return;

  // Network-first strateji (önce ağ dene, başarısız olursa cache)
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Başarılı yanıtı cache'e de yaz
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push bildirimi
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'MarketPas', {
      body: data.body || 'Sıranız geldi!',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'marketpas-queue',
      requireInteraction: true,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      if (list.length) { list[0].focus(); return; }
      clients.openWindow(e.notification.data?.url || '/');
    })
  );
});
