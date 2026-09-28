// Lets the app open without internet. Always tries the newest version first, falls back to the saved copy.
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request)
    .then(r => { const copy = r.clone(); caches.open('v1').then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request))
));
