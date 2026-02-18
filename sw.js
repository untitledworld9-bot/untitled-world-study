self.addEventListener("install", e => {
  console.log("App Installed");

  e.waitUntil(
    // Maine yahan 'v3' kar diya hai taaki naya update turant dikhe
    caches.open("app-cache-v3").then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/timer.html",       // <-- Ye zaroori hai naye Timer ke liye
        "/icon.png",
        "/background.webp",
        "/manifest.json"     // <-- Ise bhi add kar lo
      ]);
    })
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
