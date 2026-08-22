/**
 * Service worker — Web Push for incoming WhatsApp call alerts.
 * Registered by CallManager; payloads come from lib/push.ts.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not json */ }
  const title = data.title || 'WhatsApp Panel';
  event.waitUntil(self.registration.showNotification(title, {
    body:  data.body || '',
    tag:   data.tag || undefined,          // same tag → re-ring replaces, no pile-up
    renotify: !!data.tag,
    data:  { url: data.url || '/inbox' },
    vibrate: [200, 100, 200, 100, 200],    // ring-ish buzz on Android
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/inbox';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing panel tab if one is open — the call popup is already there
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
