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

// ─────────────────────────────────────────────────────────────
const CACHE = "sgp-cache-v3";

// ✅ Sirf wahi files jo 100% exist karti hain
const ASSETS = [
  "/index.html",
  "/offline.html",
  "/focus.html",
  "/timer.html",
  "/todo.html",
  "/playlist.html",
  "/profile.html",
  "/mock.html",
  "/manifest.json",
  "/style.css",
  "/script.js",
  "/theme.js",
  "/icon-192.png",
  "/icon-512.png",
  "/admin/studygridadmin.html",
  "/admin/manifestadmin.json"
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // ✅ Individual try — ek fail ho toh baaki cache hoti rahe
      return Promise.allSettled(
        ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn("Cache miss:", url, err)
          )
        )
      );
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const req = event.request;

  // External requests — ignore
  if (!req.url.startsWith(self.location.origin)) return;

  // POST etc. — ignore
  if (req.method !== "GET") return;

  // ── NAVIGATION (page open) ──────────────────────────────
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Network se mila → cache update karo aur return karo
          if (res && res.status === 200) {
            caches.open(CACHE).then(c => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(async () => {
          // Network fail → cache check karo
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;

          // Cache mein bhi nahi → offline page
          const offlinePage = await caches.match("/offline.html");
          return offlinePage || new Response(
            "<h2>Offline</h2><button onclick='location.reload()'>Retry</button>",
            { headers: { "Content-Type": "text/html" } }
          );
        })
    );
    return;
  }

  // ── STATIC FILES (CSS, JS, images) ──────────────────────
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE).then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => null);

      // Cache hai → turant serve, background mein update
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      // Cache nahi → network se lo
      return networkFetch;
    })
  );
});

// ── MESSAGE ──────────────────────────────────────────────────
const scheduledNotifications = new Map();

self.addEventListener("message", event => {
  const data = event.data;
  if (!data) return;

  if (data === "skipWaiting" || data.type === "skipWaiting") {
    self.skipWaiting();
    return;
  }

  // Net wapas aaya → sab pages reload karo
  if (data.type === "CLIENT_ONLINE") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then(list => {
        list.forEach(c => c.postMessage({ type: "RELOAD_NOW" }));
      })
    );
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
  if ("focus" in c) { await c.focus(); return; }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
