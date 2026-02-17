self.addEventListener("install", e => {
  console.log("App Installed");

  e.waitUntil(
    caches.open("app-cache").then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/icon.png",
        "/background.webp"
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
