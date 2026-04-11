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

// ─── Cache version — CHANGE KARO JAB BHI SW UPDATE KARO ──────────────────
const CACHE = "sgp-cache-v3";

const ASSETS = [
  "/",
  "/index.html",
  "/offline.html",   // ← MUST exist on server
  "/timer.html",
  "/playlist.html",
  "/todo.html",
  "/profile.html",
  "/mock.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// ── INSTALL ──────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      // offline.html PEHLE cache karo — agar yeh fail hua toh SW install rok do
      await cache.add("/offline.html");

      // Baaki files — ek fail ho toh doosre continue karein
      await Promise.allSettled(
        ASSETS.filter(u => u !== "/offline.html").map(url =>
          cache.add(url).catch(e => console.warn("[SW] Cache miss:", url, e))
        )
      );
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const req = event.request;

  if (!req.url.startsWith(self.location.origin)) return;
  if (req.method !== "GET") return;

  // ── NAVIGATION — CACHE FIRST (offline ke liye instant response) ──────
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async cache => {

        // 1. Cache check karo pehle (ignoreSearch = ?mode=pwa bhi match ho)
        const cached = await cache.match(req, { ignoreSearch: true });

        // 2. Background mein network se update karo
        const updateCache = fetch(req)
          .then(res => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        // 3. Cache mila → TURANT return karo (no wait for network)
        if (cached) {
          event.waitUntil(updateCache);
          return cached;
        }

        // 4. Cache nahi → network try karo
        const networkRes = await updateCache;
        if (networkRes) return networkRes;

        // 5. Dono fail → offline.html serve karo (browser URL bar nahi badlega)
        return cache.match("/offline.html");
      })
    );
    return;
  }

  // ── STATIC ASSETS — Cache first, background update ───────────────────
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });

      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
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

// ── MESSAGE ───────────────────────────────────────────────────────────────
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

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────
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