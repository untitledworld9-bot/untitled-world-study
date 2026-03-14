// ─── Untitled World – Service Worker ───────────────────────────────────────
// Strategy:
//   • Navigation  → Network-first  → offline.html fallback (never ERR_FAILED)
//   • Static      → Cache-first    → network fallback
// ────────────────────────────────────────────────────────────────────────────

const CACHE = "uw-cache-v9";          // bump version when assets change

const ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/focus.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/background.webp"
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();                 // activate immediately on first install

  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", event => {
  // Delete old cache versions so stale files don't linger
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())  // take control of all open tabs NOW
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {

  // ── Navigation requests (HTML page loads) ──────────────────────────────────
  if (event.request.mode === "navigate") {

  event.respondWith(
    fetch(event.request)
      .catch(async () => {

        const cache = await caches.open(CACHE);
        const offline = await cache.match("/offline.html");

        if (offline) {
          return new Response(await offline.text(), {
            headers: { "Content-Type": "text/html" }
          });
        }

        return getOfflinePage();
      })
  );

  return;
}

  // ── Static assets (cache-first) ────────────────────────────────────────────
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Opportunistically cache successful responses for static assets
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );

});

// ── Helper: always return a valid Response for the offline page ───────────────
async function getOfflinePage() {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match("/offline.html");

  if (cached) return cached;

  // Last-resort inline fallback – guarantees NO ERR_FAILED ever appears
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>
  body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;
       justify-content:center;font-family:system-ui,sans-serif;background:#f4f6f8;text-align:center;}
  button{margin-top:24px;padding:12px 28px;border:none;border-radius:12px;
         background:#ff7a18;color:#fff;font-size:16px;font-weight:600;cursor:pointer;}
</style>
</head>
<body>
  <h1>📡 You're Offline</h1>
  <p>Please check your internet connection.</p>
  <button onclick="location.href='/'">Retry</button>
  <script>window.addEventListener("online",()=>location.href="/");<\/script>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
