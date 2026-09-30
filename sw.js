// Lets the app open without internet. Always tries the newest version first, falls back to the saved copy.
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request)
    .then(r => { const copy = r.clone(); caches.open('v1').then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request))
));

// The 6:50 PM reminder (sent by GitHub, see .github/workflows/reminder.yml).
self.addEventListener('push', e => e.waitUntil(
  self.registration.showNotification('Clutch', { body: e.data ? e.data.text() : 'Evening check time!', icon: 'icon.png' })
));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('./')); });
