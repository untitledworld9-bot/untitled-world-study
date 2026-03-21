// ─── Untitled World – FCM Background Messaging Service Worker ────────────────
// Must be named exactly "firebase-messaging-sw.js" for FCM to work.
// Handles push notifications when PWA is CLOSED or in BACKGROUND.
// When PWA is OPEN → index.js Firestore listener handles in-app notifications.
// ─────────────────────────────────────────────────────────────────────────────

importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain:        "untitled-world-2e645.firebaseapp.com",
  projectId:         "untitled-world-2e645",
  messagingSenderId: "990115586087",
  appId:             "1:990115586087:web:963f68bd59dec5ef0c6e02"
});

const messaging = firebase.messaging();

// ── BACKGROUND MESSAGE ─────────────────────────────────────────────────────
// payload.notification → title/body set in Firebase Console or FCM API
// payload.data         → custom keys, e.g. { url: "/todo.html" }
messaging.onBackgroundMessage(function(payload) {
  const notification = payload.notification || {};
  const data         = payload.data         || {};

  const title = notification.title  || "Untitled World";
  const body  = notification.body   || "";
  const url   = data.url            || "/";
  const image = notification.image  || data.image || null; // ← ADD

  self.registration.showNotification(title, {
    body,
    icon    : "/icon-192.png",
    badge   : "/icon-192.png",
    image   : image || undefined,    // ← ADD — yahi poster dikhata hai!
    vibrate : [200, 100, 200],
    data    : { url },
    actions : [{ action: "open", title: "Open" }]
  });
});
// ── NOTIFICATION CLICK ─────────────────────────────────────────────────────
// Tapping the notification opens the app at the correct page.
// data.url is set from payload.data.url sent by admin/FCM.
self.addEventListener("notificationclick", function(event) {

  event.notification.close();

  const rawUrl     = (event.notification.data && event.notification.data.url) || "/";
  const absoluteUrl = rawUrl.startsWith("http")
    ? rawUrl
    : "https://untitledworld.us.cc" + rawUrl;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        // If a tab already shows that exact URL, focus it
        for (const client of clientList) {
          if (client.url === absoluteUrl && "focus" in client) {
            return client.focus();
          }
        }
        // If any app tab is open, navigate it to the target URL
        for (const client of clientList) {
          if (client.url.includes("untitledworld.us.cc") && "navigate" in client) {
            return client.navigate(absoluteUrl).then(c => c && c.focus());
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(absoluteUrl);
        }
      })
  );
});
