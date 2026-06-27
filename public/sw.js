/* Service worker — runs in the background even when the app/tab is closed.
   Receives push messages from our server, shows them as system notifications,
   and opens the app (or a live stream) when one is tapped. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { title: 'Market Terminal', body: event.data && event.data.text() }; }

  const title = data.title || 'Market Terminal';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/', watchUrl: data.watchUrl || '' },
    actions: data.watchUrl ? [{ action: 'watch', title: '▶ Watch live' }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = event.action === 'watch' && d.watchUrl ? d.watchUrl : (d.url || '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (event.action !== 'watch') {
        for (const client of clients) { if ('focus' in client) return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
