importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
 apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
 authDomain: "untitled-world-2e645.firebaseapp.com",
 projectId: "untitled-world-2e645",
 messagingSenderId: "990115586087",
 appId: "1:990115586087:web:963f68bd59dec5ef0c6e02"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
 const title = payload.notification.title;
 const options = {
  body: payload.notification.body,
  icon: "/icon-192.png"
 };
 self.registration.showNotification(title, options);
});

// ─── Study Grid Prep – Advanced Service Worker ───────────────────────────────
const CACHE = "uw-cache-v24";

const ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/focus.html",
  "/todo.html",
  "/profile.html",
  "/subscription.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/background.webp"
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const req = event.request;

  if (!req.url.startsWith(self.location.origin)) return;

  // 🔥 NAVIGATION REQUEST (page load)
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req).then(cached => {
        // ✅ agar cached page hai → turant dikha
        if (cached) return cached;

        // ❌ nahi hai → try network
        return fetch(req).catch(async () => {
          const cache = await caches.open(CACHE);
          return await cache.match("/offline.html");
        });
      })
    );
    return;
  }

  // 🔥 STATIC FILES
  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req);
    })
  );
});

// ── ✅ BACKGROUND NOTIFICATION SCHEDULING ────────────────────────────────────
// Map of id -> { timeout, resolve } so multiple timers/todos can be scheduled
const scheduledNotifications = new Map();

// ── MESSAGE ──────────────────────────────────────────────────────────────────
self.addEventListener("message", event => {
  const data = event.data;
  if (!data) return;

  // ── skipWaiting (auto update trigger) ──────────────────────────────────────
  if (data === "skipWaiting" || data.type === "skipWaiting") {
    self.skipWaiting();
    return;
  }

  // ── SCHEDULE_NOTIFICATION ─────────────────────────────────────────────────
  // Focus timer / todo reminders call this when a timer starts
  // Works even if the app tab is closed — SW keeps it alive
  if (data.type === "SCHEDULE_NOTIFICATION") {
    const { id = "default", endTime, title, body, url } = data;
    const delay = endTime - Date.now();

    // Cancel any existing scheduled notification with same id
    if (scheduledNotifications.has(id)) {
      const existing = scheduledNotifications.get(id);
      clearTimeout(existing.timeout);
      existing.resolve(); // release old waitUntil
      scheduledNotifications.delete(id);
    }

    if (delay <= 0) return; // already past the time

    // event.waitUntil keeps the SW alive until the Promise resolves
    event.waitUntil(new Promise(resolve => {
      const timeout = setTimeout(async () => {
        await self.registration.showNotification(title || "Study Grid Prep", {
          body: body || "",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          vibrate: [200, 100, 200],
          requireInteraction: true,
          data: { url: url || "/" }
        });
        scheduledNotifications.delete(id);
        resolve(); // let SW sleep again
      }, delay);

      scheduledNotifications.set(id, { timeout, resolve });
    }));
    return;
  }

  // ── CANCEL_NOTIFICATION ───────────────────────────────────────────────────
  // Called when timer is reset/paused, or page handles completion itself
  if (data.type === "CANCEL_NOTIFICATION") {
    const { id = "default" } = data;
    if (scheduledNotifications.has(id)) {
      const existing = scheduledNotifications.get(id);
      clearTimeout(existing.timeout);
      existing.resolve();
      scheduledNotifications.delete(id);
    }
    return;
  }
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data ? event.notification.data.url : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── SAFE OFFLINE PAGE ────────────────────────────────────────────────────────
async function getOfflinePage() {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match("/offline.html");
  if (cached) return cached;

  return new Response(
`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:sans-serif;background:#f5f6fa;text-align:center;}
button{margin-top:20px;padding:12px 24px;border:none;border-radius:10px;
background:#ff7a18;color:white;font-size:16px;cursor:pointer;}
</style>
</head>
<body>
<div>
<h2>📡 Offline</h2>
<p>Check your internet connection</p>
<button onclick="location.reload()">Retry</button>
</div>
</body>
</html>`,
  { headers: { 'Content-Type': 'text/html' } });
}
