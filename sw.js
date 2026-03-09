const CACHE = "uw-cache-v7";

const OFFLINE_URL = "/offline.html";

self.addEventListener("install", event => {

self.skipWaiting();

event.waitUntil(

caches.open(CACHE).then(cache => {
return cache.addAll([
"/",
"/index.html",
"/offline.html",
"/manifest.json",
"/icon-192.png",
"/icon-512.png",
"/background.webp"
];
})

);

});

self.addEventListener("activate", event => {

event.waitUntil(self.clients.claim());

});

self.addEventListener("fetch", event => {

if(event.request.mode === "navigate"){

event.respondWith(

fetch(event.request).catch(()=>{

return caches.match(OFFLINE_URL);

})

);

return;

}

event.respondWith(

caches.match(event.request).then(res=>{
return res || fetch(event.request);
})

);

});