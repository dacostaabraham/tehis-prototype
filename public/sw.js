// Service worker : garde l'interface et les modèles 3D en cache, affiche les rappels (notifications push).
// L'API passe toujours par le réseau.
const CACHE = 'tehis-v9';
const COQUILLE = ['/', '/index.html', '/styles.css', '/app.js', '/cards.js', '/perso.js', '/voix.js', '/lieux.js', '/shared/ui.js', '/companion.js', '/charts.js', '/shared/finance.js', '/shared/budget.js', '/shared/agents.js', '/shared/markdown.js', '/shared/progression.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Modèles et images : cache d'abord. Le reste : réseau d'abord, cache en secours.
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/pets/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const copie = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => { const copie = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corps: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'Tehis', {
    body: d.corps || '', tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
    const ouverte = fenetres.find((w) => new URL(w.url).origin === self.location.origin);
    if (ouverte) { ouverte.navigate(cible); return ouverte.focus(); }
    return self.clients.openWindow(cible);
  }));
});
