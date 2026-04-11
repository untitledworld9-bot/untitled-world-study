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
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/icon-192.png"
  });
});

const CACHE = "sgp-cache-v5"; // ← version badla

const ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/timer.html",
  "/playlist.html",
  "/todo.html",
  "/profile.html",
  "/mock.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // ✅ allSettled — koi bhi file fail ho, install rukta nahi
      Promise.allSettled(
        ASSETS.map(url => cache.add(url))
      ).then(results => {
        results.forEach((r, i) => {
          if (r.status === "rejected")
            console.warn("[SW] Failed to cache:", ASSETS[i]);
        });
      })
    )
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const req = event.request;
  if (!req.url.startsWith(self.location.origin)) return;
  if (req.method !== "GET") return;

  // NAVIGATION — cache first, turant response
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async cache => {

        // Cache mein dhundho (query string ignore)
        const cached = await cache.match(req, { ignoreSearch: true })
                    || await cache.match("/index.html")
                    || await cache.match("/");

        // Background mein network update
        const networkUpdate = fetch(req)
          .then(res => {
            if (res?.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        // Cache mila → turant dikha
        if (cached) {
          event.waitUntil(networkUpdate);
          return cached;
        }

        // Cache nahi → network try
        const netRes = await networkUpdate;
        if (netRes) return netRes;

        // Dono fail → offline page
        return await cache.match("/offline.html");
      })
    );
    return;
  }

  // STATIC FILES — cache first
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });

      const networkFetch = fetch(req)
        .then(res => {
          if (res?.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      return await networkFetch;
    })
  );
});

// ── MESSAGE ───────────────────────────────────────────────────
const scheduledNotifications = new Map();

self.addEventListener("message", event => {
  const data = event.data;
  if (!data) return;

  if (data === "skipWaiting" || data.type === "skipWaiting") {
    self.skipWaiting();
    return;
  }

  if (data.type === "SCHEDULE_NOTIFICATION") {
    const { id = "default", endTime, title, body, url } = data;
    const delay = endTime - Date.now();

    if (scheduledNotifications.has(id)) {
      const ex = scheduledNotifications.get(id);
      clearTimeout(ex.timeout);
      ex.resolve();
      scheduledNotifications.delete(id);
    }

    if (delay <= 0) return;

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
        resolve();
      }, delay);
      scheduledNotifications.set(id, { timeout, resolve });
    }));
    return;
  }

  if (data.type === "CANCEL_NOTIFICATION") {
    const { id = "default" } = data;
    if (scheduledNotifications.has(id)) {
      const ex = scheduledNotifications.get(id);
      clearTimeout(ex.timeout);
      ex.resolve();
      scheduledNotifications.delete(id);
    }
    return;
  }
});

// ── NOTIFICATION CLICK ────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(list => {
        for (const c of list) {
          if (c.url.includes(url) && "focus" in c) return c.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});