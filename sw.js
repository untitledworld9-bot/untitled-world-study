const CACHE = "uw-cache-v3";

const ASSETS = [
"/icon-192.png",
"/icon-512.png",
"/background.webp",
"/manifest.json"
];

self.addEventListener("install", e=>{
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE).then(cache=>{
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("activate", e=>{
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", e=>{

  // Pages always load from network
  if(e.request.mode === "navigate"){
    e.respondWith(fetch(e.request));
    return;
  }

  // Static files cache
  e.respondWith(
    caches.match(e.request).then(res=>{
      return res || fetch(e.request);
    })
  );

});