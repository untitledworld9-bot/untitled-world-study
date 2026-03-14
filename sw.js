// ─── Untitled World – Indestructible Service Worker ────────────────────────

const CACHE = "uw-cache-v13"; // Version 13

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

// ── INSTALL (FAIL-SAFE LOGIC) ──
self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // PRO LOGIC: 'addAll' ki jagah ek-ek karke save karega.
      // Agar ek file miss bhi hui, toh app crash nahi hoga, baaki save ho jayengi.
      return Promise.all(
        ASSETS.map(url => {
          return cache.add(url).catch(err => console.error("Missing file, but continuing:", url));
        })
      );
    })
  );
});

// ── ACTIVATE ──
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener("fetch", event => {
  // Sirf GET requests handle karenge, baaki ko ignore (taki API errors na aayein)
  if (event.request.method !== "GET") return;

  // ── Navigation requests (Pages) ──
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        try {
          const cache = await caches.open(CACHE);
          const url = event.request.url.toLowerCase();

          // 1. Agar URL me 'focus' hai, toh zabardasti focus.html kholo (Strict Match)
          if (url.includes("focus")) {
            const focusPage = await cache.match("/focus.html", { ignoreSearch: true });
            if (focusPage) return focusPage;
          }

          // 2. Normal Page Match
          const cachedPage = await cache.match(event.request, { ignoreSearch: true });
          if (cachedPage) return cachedPage;

          // 3. Sab fail toh offline.html
          const offlinePage = await cache.match("/offline.html", { ignoreSearch: true });
          if (offlinePage) return offlinePage;

          // 4. Aakhri rasta (Browser default error rokne ke liye)
          return getOfflinePage();
        } catch (e) {
          return getOfflinePage();
        }
      })
    );
    return;
  }

  // ── Static assets (Images, CSS, JS) ──
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      return cached || fetch(event.request).catch(() => new Response("")); // Blank response taki ERR_FAILED na aaye
    })
  );
});

// ── Helper ──
function getOfflinePage() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Offline</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f4f6f8;text-align:center;}button{margin-top:24px;padding:12px 28px;border:none;border-radius:12px;background:#ff7a18;color:#fff;font-size:16px;font-weight:600;cursor:pointer;}</style></head><body><h1>📡 You're Offline</h1><p>Please check your internet connection.</p><button onclick="location.href='/'">Retry</button><script>window.addEventListener("online",()=>location.href="/");<\/script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
