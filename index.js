/**
 * index.js — Untitled World (FIXED)
 *
 * FIX-I  : announcements composite index error — single orderBy, active filter client-side.
 * FIX-J  : notifications composite index error — single where(), createdAt filter client-side.
 * FIX-K  : bfcache restore — pageshow listener added.
 * FIX-L  : announcements createdAt guard removed — was dropping all stored docs.
 * FIX-M  : promotions field "body" not "message".
 * FIX-N  : promotions popup — reuse existing #promoPopup + setProperty("display","flex","important").
 * FIX-O  : pagehide nulls unsub refs so bfcache restore re-attaches listeners.
 * FIX-P  : markSeen poisoning — markSeen() is now called AFTER successful render.
 * FIX-Q  : removed aggressive controllerchange force reload loop in SW.
 * FIX-R  : added App Updates live listener for 'appUpdates/latest'.
 * FIX-SYN: missing // before section-8 separator was a syntax error that broke boot().
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONSTANTS & SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────

const SK = {
  ANNOUNCEMENTS : "uw_seen_announcements",
  NOTIFICATIONS : "uw_seen_notifications",
  PROMOTIONS    : "uw_seen_promotions",
  LISTENERS_BOOT: "uw_listeners_booted"
};

const seen = {
  announcements : new Set(JSON.parse(sessionStorage.getItem(SK.ANNOUNCEMENTS) || "[]")),
  notifications : new Set(JSON.parse(sessionStorage.getItem(SK.NOTIFICATIONS) || "[]")),
  promotions    : new Set(JSON.parse(sessionStorage.getItem(SK.PROMOTIONS)    || "[]"))
};

function markSeen(type, id) {
  seen[type].add(id);
  try {
    sessionStorage.setItem(
      SK[type.toUpperCase()],
      JSON.stringify([...seen[type]])
    );
  } catch (_) { /* quota exceeded — in-memory Set still guards */ }
}

const CURRENT_USER = localStorage.getItem("userName") || null;

const unsubs = {
  announcements : null,
  notifications : null,
  promotions    : null,
  appUpdates    : null
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function qs(selector, root = document) {
  try { return root.querySelector(selector); } catch (_) { return null; }
}

function safeAppend(parent, child) {
  if (parent && child) parent.appendChild(child);
}

function autoRemove(el, ms) {
  setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function showToast(html, duration = 5000) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed;bottom:24px;right:20px;
    background:#1e3a5f;color:#e2f0ff;
    padding:14px 20px;border-radius:14px;
    font-size:14px;font-weight:600;
    box-shadow:0 6px 20px rgba(0,0,0,0.5);
    z-index:99999;max-width:300px;
    border:1px solid rgba(0,242,254,0.25);
    line-height:1.5;
  `;
  toast.innerHTML = html;
  safeAppend(document.body, toast);
  autoRemove(toast, duration);
}

function isPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SERVICE WORKER
// ─────────────────────────────────────────────────────────────────────────────

function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then(reg => console.log("[SW] FCM worker:", reg.scope))
    .catch(err => console.warn("[SW] FCM error:", err));

  navigator.serviceWorker
    .register("/sw.js")
    .then(reg => {
      console.log("[SW] App worker:", reg.scope);

      const handleWaiting = w => {
        if (!w) return;
        showToast(
          `🔄 New update available!<br>
           <span style="font-weight:400;font-size:12px">Downloading updates in background...</span>`,
          4000
        );
        w.postMessage("skipWaiting");
      };

      if (reg.waiting) handleWaiting(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            handleWaiting(nw);
          }
        });
      });
    })
    .catch(err => console.warn("[SW] App worker error:", err));
    
  // FIX-Q: Aggressive controllerchange force-reload loop hata diya gaya hai.
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. APP UPDATES SYSTEM (FIX-R)
// ─────────────────────────────────────────────────────────────────────────────

function initAppUpdates() {
  if (unsubs.appUpdates) return;

  unsubs.appUpdates = onSnapshot(doc(db, "appUpdates", "latest"), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    
    // Sirf tab dikhao jab active true ho
    if (!data.active) return;
    
    showUpdatePopup(data);
  }, err => {
    console.warn("[AppUpdates] Firestore error:", err);
  });
}

function showUpdatePopup(updateData) {
  // Check if popup already exists to prevent duplication
  if (document.getElementById("uw-update-popup")) return;

  const overlay = document.createElement("div");
  overlay.id = "uw-update-popup";
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);
    backdrop-filter: blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;`;
    
  overlay.innerHTML = `
    <div style="background:#0d0f18;border:1px solid rgba(0,224,255,.3);border-radius:16px;
                padding:32px;max-width:360px;width:90%;text-align:center;color:#eef0ff;
                box-shadow: 0 10px 40px rgba(0,0,0,0.6);">
      <div style="font-size:48px;margin-bottom:12px;">🚀</div>
      <h2 style="font-size:20px;margin-bottom:8px;font-family:sans-serif;">Update Available</h2>
      <p style="color:#8890b0;font-size:13px;margin-bottom:12px;font-family:monospace;">${updateData.version || "New Version"}</p>
      
      <div style="text-align:left;font-size:12px;color:#8890b0;background:#07080d;
                  padding:14px;border-radius:8px;margin-bottom:24px;border:1px solid rgba(255,255,255,0.06);
                  max-height: 120px; overflow-y: auto; white-space:pre-wrap;line-height:1.5;">${updateData.changelog || "Bug fixes and performance improvements."}</div>
                  
      <button id="updateNowBtn"
        style="background:linear-gradient(135deg, #00e0ff, #7c5cfc);border:none;
               padding:14px 32px;border-radius:10px;color:#000;font-weight:700;
               font-size:14px;cursor:pointer;width:100%;transition:opacity 0.2s;">
        Update App
      </button>
      
      ${updateData.type !== "forced"
        ? `<button id="dismissUpdateBtn"
             style="background:none;border:none;color:#8890b0;margin-top:16px;
                    cursor:pointer;font-size:13px;text-decoration:underline;">Not Now</button>`
        : ""}
    </div>`;
    
  document.body.appendChild(overlay);

  document.getElementById("updateNowBtn").onclick = async () => {
    const btn = document.getElementById("updateNowBtn");
    btn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.2);
                    border-top-color:#000;border-radius:50%;animation:spin .6s linear infinite;
                    margin-right:8px;vertical-align:middle;"></span>Updating…`;
    btn.style.opacity = "0.8";
    btn.disabled = true;
    
    // Clear service worker cache if applicable
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch(e) { console.warn("Cache clear failed", e); }
    }
    setTimeout(() => location.reload(true), 1500);
  };

  if (updateData.type !== "forced") {
    document.getElementById("dismissUpdateBtn").onclick = () => {
       overlay.remove();
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ANNOUNCEMENT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

function initAnnouncements() {
  if (unsubs.announcements) return;

  const q = query(
    collection(db, "announcements"),
    orderBy("createdAt", "desc"),
    limit(5)
  );

  unsubs.announcements = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== "added") return;

      const id   = change.doc.id;
      const data = change.doc.data();

      if (!data.active) return;
      if (seen.announcements.has(id)) return;
      if (!data.text) return;
      if (data.target === "pwa" && !isPWA()) return;

      renderAnnouncementBanner(data.text);
      
      // FIX-P: Mark seen AFTER successful render
      markSeen("announcements", id);
    });
  }, err => {
    console.warn("[Announcements] Firestore error:", err);
  });
}

function renderAnnouncementBanner(text) {
  const banner = document.createElement("div");
  banner.className = "admin-msg";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.textContent = "📢 " + text;

  const container = qs("#announcement-container") || document.body;
  safeAppend(container, banner);
  autoRemove(banner, 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. NOTIFICATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

function initNotifications() {
  if (unsubs.notifications) return;

  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  const startTime = Timestamp.now();

  const makeQuery = userValue =>
    query(
      collection(db, "notifications"),
      where("user", "==", userValue),
      limit(10)
    );

  const handleChange = snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== "added") return;

      const id   = change.doc.id;
      const data = change.doc.data();

      if (data.createdAt && data.createdAt.toMillis() < startTime.toMillis()) return;
      if (seen.notifications.has(id)) return;
      if (!data.title || !data.body) return;

      fireNotification(data.title, data.body);
      
      // FIX-P: Mark seen AFTER successful notification trigger
      markSeen("notifications", id);
    });
  };

  const errHandler = err => console.warn("[Notifications] Firestore error:", err);

  const unsubAll  = onSnapshot(makeQuery("all"), handleChange, errHandler);
  let   unsubUser = () => {};
  if (CURRENT_USER) {
    unsubUser = onSnapshot(makeQuery(CURRENT_USER), handleChange, errHandler);
  }

  unsubs.notifications = () => { unsubAll(); unsubUser(); };
}

function fireNotification(title, body) {
  if (Notification.permission !== "granted") return;
  const opts = { body, icon: "/icon-192.png", badge: "/icon-192.png" };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(() => { try { new Notification(title, opts); } catch (_) {} });
  } else {
    try { new Notification(title, opts); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PROMOTION POPUP SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

function initPromotions() {
  if (unsubs.promotions) return;

  const q = query(
    collection(db, "promotions"),
    where("active", "==", true),
    limit(5)
  );

  unsubs.promotions = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== "added") return;

      const id   = change.doc.id;
      const data = change.doc.data();

      // FIX-P: Sahi Order with markSeen at the end
      if (seen.promotions.has(id)) return;
      if (!data.active) return;
      if (!data.title && !data.body) return;
      
      renderPromotionPopup(data);
      markSeen("promotions", id);   
    });
  }, err => {
    console.warn("[Promotions] Firestore error:", err);
  });
}

function renderPromotionPopup(data) {
  // FIX-N: Reuse existing #promoPopup element
  const popup = document.getElementById("promoPopup");
  if (!popup) return;

  const box = popup.querySelector(".promo-box");
  if (!box) return;

  box.innerHTML = "";

  // Close button
  const closeBtn = document.createElement("span");
  closeBtn.className = "promo-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => popup.style.setProperty("display", "none", "important");

  // Title
  const titleEl = document.createElement("h3");
  titleEl.style.cssText = "color:#fff;margin:16px 0 10px;font-size:18px;font-weight:700;padding:0 10px;";
  titleEl.textContent = data.title || "";

  // Body
  const bodyEl = document.createElement("p");
  bodyEl.style.cssText = "color:#a4b0be;font-size:14px;line-height:1.6;margin:0 0 18px;padding:0 10px;";
  bodyEl.textContent = data.body || "";

  box.appendChild(closeBtn);
  box.appendChild(titleEl);
  box.appendChild(bodyEl);

  // CTA button
  if (data.cta) {
    const btn = document.createElement("button");
    btn.style.cssText = `
      display:block;margin:0 auto 20px;
      background:linear-gradient(45deg,#00f2fe,#4facfe);
      border:none;border-radius:20px;
      padding:10px 28px;color:#fff;
      font-weight:600;cursor:pointer;font-size:14px;
    `;
    btn.textContent = data.cta;
    btn.onclick = () => popup.style.setProperty("display", "none", "important");
    box.appendChild(btn);
  }

  popup.style.setProperty("display", "flex", "important");

  // Backdrop tap close
  popup.addEventListener("click", function handler(e) {
    if (e.target === popup) {
      popup.style.setProperty("display", "none", "important");
      popup.removeEventListener("click", handler);
    }
  });

  // Auto hide
  setTimeout(() => {
    popup.style.setProperty("display", "none", "important");
  }, (data.duration || 8) * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

function boot() {
  console.log("[UW] index.js booting…");

  initServiceWorker();

  if (sessionStorage.getItem(SK.LISTENERS_BOOT) === "1") {
    console.log("[UW] Listeners already live — skipping re-attachment.");
    return;
  }
  sessionStorage.setItem(SK.LISTENERS_BOOT, "1");

  initAnnouncements();
  initNotifications();
  initPromotions();
  initAppUpdates(); // FIX-R: Start updates listener

  console.log("[UW] All systems initialised.");
}

// Standard page load
document.addEventListener("DOMContentLoaded", boot);

// FIX-K: bfcache restore
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    console.log("[UW] bfcache restore — re-attaching listeners.");
    sessionStorage.removeItem(SK.LISTENERS_BOOT);
    boot();
  }
});

// FIX-O: null refs after unsub so bfcache restore works
window.addEventListener("pagehide", () => {
  if (typeof unsubs.announcements === "function") { unsubs.announcements(); unsubs.announcements = null; }
  if (typeof unsubs.notifications === "function") { unsubs.notifications(); unsubs.notifications = null; }
  if (typeof unsubs.promotions    === "function") { unsubs.promotions();    unsubs.promotions = null; }
  if (typeof unsubs.appUpdates    === "function") { unsubs.appUpdates();    unsubs.appUpdates = null; } // Cleanup added
  sessionStorage.removeItem(SK.LISTENERS_BOOT);
});
