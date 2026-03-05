self.addEventListener("install", e => {

  e.waitUntil(
    caches.open("app-cache-v4").then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/timer.html",
        "/icon-192.png",
        "/icon-512.png",
        "/background.webp",
        "/manifest.json"
      ]);
    })
  );

});

self.addEventListener("fetch", e => {

  e.respondWith(
    caches.match(e.request).then(response => {
      return response || fetch(e.request);
    })
  );

});