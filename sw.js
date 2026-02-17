self.addEventListener("install", e => {
  console.log("App Installed");

  e.waitUntil(
    caches.open("app-cache-v2").then(cache => {
      return cache.addAll([
        "/index.html",
        "/icon.png",
        "/background.webp"
      ]);
    })
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
