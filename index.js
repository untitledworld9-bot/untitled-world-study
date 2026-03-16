/**
 * index.js — Untitled World (FIXED)
 *
 * Bugs fixed in this file:
 *
 *   FIX-I (announcements query, line 266):
 *     Original: where("active","==",true) + where("createdAt",">=",start) + orderBy("createdAt","desc")
 *     This requires a composite index on [active ASC, createdAt DESC] in the
 *     Firebase Console. Without it: "FirestoreError: The query requires an index."
 *     Fix: use only orderBy("createdAt","desc") — Firestore auto-indexes single
 *          fields. Filter `active` and recency client-side in the callback.
 *
 *   FIX-J (notifications query, line 350):
 *     Same composite index error: where("user","==",x) + where("createdAt",">=",t)
 *     + orderBy("createdAt","desc"). Fixed the same way — single where("user","==",x),
 *     filter createdAt client-side.
 *
 *   FIX-K (bfcache, line 525):
 *     Only DOMContentLoaded was used for boot. When the browser restores a page
 *     from bfcache (user presses Back), DOMContentLoaded does NOT fire. The
 *     pagehide event had cleared the boot flag but the listeners were gone.
 *     Fix: added a pageshow listener that re-runs boot() when event.persisted.
 *
 *   FIX-L (announcements not showing):
 *     createdAt < startTime guard was dropping ALL pre-existing active docs because
 *     onSnapshot fires immediately with the full result set and every stored doc
 *     has createdAt < Timestamp.now(). Removed the recency guard — the seen Set
 *     (sessionStorage-backed) already prevents duplicate rendering within a session.
 *
 *   FIX-M (promotions field name mismatch):
 *     Firestore schema uses field "body" but code was reading data.message (always
 *     undefined). Fixed guard condition and msgEl.textContent to use data.body.
 *
 *   FIX-N (promotions popup invisible):
 *     box.className = "promo-popup" inherited CSS display:none from index.html.
 *     style.cssText never set display, so the CSS rule won and the element was
 *     invisible even after being appended to body.
 *     Fix: renamed class to "uw-promo-toast" + added display:block to style.cssText.
 *
 *   FIX-O (bfcache restore skips init):
 *     pagehide called unsub functions but never nulled the refs. On bfcache
 *     restore, unsubs.x was still truthy, so initX() hit the early-return guard
 *     and no listeners were re-attached.
 *     Fix: null each ref immediately after calling it in pagehide.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./firebase.js";

import {
  collection,
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
  promotions    : null
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

  // FCM requires the SW to be named exactly "firebase-messaging-sw.js"
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then(reg => console.log("[SW] FCM worker:", reg.scope))
    .catch(err => console.warn("[SW] FCM error:", err));

  // App caching SW
  navigator.serviceWorker
    .register("/sw.js")
    .then(reg => {
      console.log("[SW] App worker:", reg.scope);

      const handleWaiting = w => {
        if (!w) return;
        showToast(
          `🔄 New update available!<br>
           <span style="font-weight:400;font-size:12px">Reloading in 3 s…</span>`,
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

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. ANNOUNCEMENT SYSTEM
//
// FIX-I: Original query combined where("active","==",true) with
//        where("createdAt",">=",startTime) and orderBy("createdAt","desc").
//        Firestore requires a manually-created composite index for this
//        combination. Without it the listener immediately errors out:
//        "FirestoreError: The query requires an index."
//
//        Fix: use orderBy("createdAt","desc") only — Firestore auto-creates
//        single-field indexes. Apply the `active` check client-side inside
//        the callback. No Firebase Console index needed.
//
// FIX-L: Removed createdAt < startTime guard. onSnapshot fires immediately
//        with ALL matching docs — every stored doc has createdAt < Timestamp.now()
//        so the guard was silently dropping every announcement.
//        The seen Set (sessionStorage-backed) already prevents duplicates.
// ─────────────────────────────────────────────────────────────────────────────

function initAnnouncements() {

  if (unsubs.announcements) return;

  // FIX-I: single orderBy — no composite index required
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

      // FIX-I: client-side active filter
      if (!data.active) return;

      // FIX-L: createdAt recency guard REMOVED — it was dropping every stored
      //        doc because Timestamp.now() is always newer than any saved doc.
      //        seen Set below already prevents showing the same doc twice.

      if (seen.announcements.has(id)) return;
      markSeen("announcements", id);

      if (!data.text) return;

      // Respect optional target field ("pwa" | "all")
      if (data.target === "pwa" && !isPWA()) return;

      renderAnnouncementBanner(data.text);
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

  // Uses #announcement-container if present in HTML; falls back to body.
  // Add <div id="announcement-container"> to index.html for correct positioning.
  const container = qs("#announcement-container") || document.body;
  safeAppend(container, banner);
  autoRemove(banner, 5000);
}


// ─────────────────────────────────────────────────────────────────────────────
// 6. NOTIFICATION SYSTEM
//
// FIX-J: Same composite index issue as announcements.
//        Original: where("user","==",x) + where("createdAt",">=",t) + orderBy(...)
//        Fix: single where("user","==",x), filter createdAt client-side.
// ─────────────────────────────────────────────────────────────────────────────

function initNotifications() {

  if (unsubs.notifications) return;

  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  const startTime = Timestamp.now();

  // FIX-J: single where() only — no composite index required
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

      // FIX-J: client-side recency filter
      if (data.createdAt && data.createdAt.toMillis() < startTime.toMillis()) return;

      if (seen.notifications.has(id)) return;
      markSeen("notifications", id);

      if (!data.title || !data.body) return;

      fireNotification(data.title, data.body);
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
// 7. PROMOTION POPUP SYSTEM
//
// FIX-M: Firestore schema field is "body" but code was reading data.message
//        (always undefined). Fixed guard condition and msgEl to use data.body.
//
// FIX-N: box.className = "promo-popup" inherited CSS display:none from
//        index.html (.promo-popup { display:none }). style.cssText never set
//        display so the popup was invisible even when appended to body.
//        Fix: renamed class to "uw-promo-toast" + added display:block.
//
// (No query fix needed — single where("active","==",true) with no orderBy
//  uses the auto-created single-field index. No composite index required.)
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

      if (seen.promotions.has(id)) return;
      markSeen("promotions", id);

      if (!data.active) return;

      // FIX-M: field is "body", not "message"
      if (!data.title && !data.body) return;

      renderPromotionPopup(data);
    });

  }, err => {
    console.warn("[Promotions] Firestore error:", err);
  });
}

function renderPromotionPopup(data) {

  // Full-screen overlay — existing .promo-popup CSS use karo
  const overlay = document.createElement("div");
  overlay.className = "promo-popup";
  overlay.style.display = "flex"; // CSS display:none override

  // Centered card — existing .promo-box CSS
  const box = document.createElement("div");
  box.className = "promo-box";
  box.style.cssText = "padding:24px 20px;text-align:center;";

  // Close button — existing .promo-close CSS
  const closeBtn = document.createElement("span");
  closeBtn.className = "promo-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => overlay.remove();

  // Title
  const titleEl = document.createElement("h3");
  titleEl.style.cssText = "color:#fff;margin-bottom:10px;font-size:18px;";
  titleEl.textContent = data.title || "";

  // Body
  const bodyEl = document.createElement("p");
  bodyEl.style.cssText = "color:#a4b0be;font-size:14px;margin-bottom:16px;line-height:1.5;";
  bodyEl.textContent = data.body || "";

  // CTA button (optional — agar Firestore mein cta field hai)
  if (data.cta) {
    const btn = document.createElement("button");
    btn.style.cssText = `
      background:linear-gradient(45deg,#00f2fe,#4facfe);
      border:none;border-radius:20px;padding:10px 24px;
      color:#fff;font-weight:600;cursor:pointer;font-size:14px;
    `;
    btn.textContent = data.cta;
    btn.onclick = () => overlay.remove();
    box.appendChild(btn);
  }

  box.appendChild(closeBtn);
  box.appendChild(titleEl);
  box.appendChild(bodyEl);
  overlay.appendChild(box);

  // Backdrop click se bhi band ho
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  safeAppend(document.body, overlay);

  // Auto remove — duration field use karo (seconds mein), default 8s
  const ms = ((data.duration || 8) * 1000);
  autoRemove(overlay, ms);
}
// ─────────────────────────────────────────────────────────────────────────────
// 8. BOOTSTRAP
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

  console.log("[UW] All systems initialised.");
}

// Standard page load
document.addEventListener("DOMContentLoaded", boot);

// FIX-K: bfcache restore — DOMContentLoaded does NOT fire when the browser
//        restores a page from the back/forward cache (event.persisted === true).
//        pagehide cleared the LISTENERS_BOOT flag, but the listeners were gone.
//        On restore, re-run boot() to re-attach them.
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    console.log("[UW] bfcache restore — re-attaching listeners.");
    sessionStorage.removeItem(SK.LISTENERS_BOOT);
    boot();
  }
});

// Cleanup on navigate away
// FIX-O: null each ref after calling it — otherwise bfcache restore sees a
//        truthy unsubs.x and initX() hits the early-return guard, skipping
//        listener re-attachment entirely.
window.addEventListener("pagehide", () => {
  if (typeof unsubs.announcements === "function") { unsubs.announcements(); unsubs.announcements = null; }
  if (typeof unsubs.notifications  === "function") { unsubs.notifications();  unsubs.notifications  = null; }
  if (typeof unsubs.promotions     === "function") { unsubs.promotions();     unsubs.promotions     = null; }
  sessionStorage.removeItem(SK.LISTENERS_BOOT);
});
