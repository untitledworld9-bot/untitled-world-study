/**
 * index.js — Untitled World (FINAL FIXED)
 *
 * FIX-I   announcements composite index error
 * FIX-J   notifications query safe
 * FIX-K   bfcache restore
 * FIX-M   promotions body field fix
 * FIX-P   markSeen poisoning fix
 * FIX-Q   service worker reload loop removed
 * FIX-R   App Updates listener added
 * FIX-S   pagehide now NULLS unsubs after calling — bfcache restore was skipping
 *          initAppUpdates() because unsubs.updates was still truthy (not null)
 * FIX-T   renderAnnouncement now shows edtech-style full-width banner with
 *          priority colour, optional image, and close button
 */

import { db } from "./firebase.js";

import {
  collection,
  doc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";



/* ─────────────────────────────
   SESSION STORAGE
───────────────────────────── */

const SK = {
  ANNOUNCEMENTS : "uw_seen_announcements",
  NOTIFICATIONS : "uw_seen_notifications",
  PROMOTIONS    : "uw_seen_promotions",
  UPDATE_SEEN   : "uw_seen_update",
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
    sessionStorage.setItem(SK[type.toUpperCase()], JSON.stringify([...seen[type]]));
  } catch {}
}

const CURRENT_USER = localStorage.getItem("userName") || null;

const unsubs = {
  announcements : null,
  notifications : null,
  promotions    : null,
  updates       : null
};



/* ─────────────────────────────
   HELPERS
───────────────────────────── */

function qs(s, r = document) { try { return r.querySelector(s); } catch { return null; } }

function safeAppend(p, c) { if (p && c) p.appendChild(c); }

function autoRemove(el, ms) { setTimeout(() => { if (el?.parentNode) el.remove(); }, ms); }

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



/* ─────────────────────────────
   SERVICE WORKER
   FIX-Q: removed controllerchange → reload loop
───────────────────────────── */

function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/firebase-messaging-sw.js");
  navigator.serviceWorker.register("/sw.js");
}



/* ─────────────────────────────
   ANNOUNCEMENTS
   FIX-T: big edtech-style banner, image support, priority colour, close button
───────────────────────────── */

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
      if (data.target === "pwa" && !isPWA()) return;

      renderAnnouncement(data);
      markSeen("announcements", id); // FIX-P: after render
    });

  }, err => console.warn("[Announcements] error:", err));
}

function renderAnnouncement(data) {

  // Priority colour map
  const colours = {
    high   : { bg: "rgba(255,59,59,0.15)", border: "#ff3b3b", dot: "#ff3b3b" },
    medium : { bg: "rgba(255,184,48,0.12)", border: "#ffb830", dot: "#ffb830" },
    low    : { bg: "rgba(0,229,160,0.10)", border: "#00e5a0", dot: "#00e5a0" }
  };
  const c = colours[data.priority] || colours.medium;

  const el = document.createElement("div");
  el.style.cssText = `
    position:relative;
    width:100%;
    background:${c.bg};
    border-left:4px solid ${c.border};
    border-radius:0 12px 12px 0;
    padding:14px 44px 14px 18px;
    display:flex;
    align-items:flex-start;
    gap:12px;
    animation:slideDown .35s ease;
    font-family:inherit;
  `;

  // Priority dot
  const dot = document.createElement("span");
  dot.style.cssText = `
    flex-shrink:0;
    width:10px;height:10px;
    border-radius:50%;
    background:${c.dot};
    margin-top:5px;
    box-shadow:0 0 8px ${c.dot};
  `;

  // Text wrapper
  const textWrap = document.createElement("div");
  textWrap.style.cssText = "flex:1;min-width:0;";

  // Optional image
  if (data.imageUrl) {
    const img = document.createElement("img");
    img.src = data.imageUrl;
    img.alt = "";
    img.style.cssText = `
      width:100%;max-height:180px;
      object-fit:cover;border-radius:8px;
      margin-bottom:10px;display:block;
    `;
    img.onerror = () => img.remove();
    textWrap.appendChild(img);
  }

  // Message text
  const msg = document.createElement("div");
  msg.style.cssText = "font-size:15px;font-weight:600;color:#e2f0ff;line-height:1.5;";
  msg.textContent = (data.text || "").replace(/^📢\s*/, "");

  // Timestamp
  const meta = document.createElement("div");
  meta.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);margin-top:4px;";
  meta.textContent = "📢 Untitled World";

  textWrap.appendChild(msg);
  textWrap.appendChild(meta);

  // Close button
  const close = document.createElement("button");
  close.textContent = "✕";
  close.style.cssText = `
    position:absolute;top:10px;right:12px;
    background:none;border:none;
    color:rgba(255,255,255,0.45);
    font-size:16px;cursor:pointer;
    line-height:1;padding:2px 4px;
  `;
  close.onclick = () => el.remove();

  el.appendChild(dot);
  el.appendChild(textWrap);
  el.appendChild(close);

  const container = qs("#announcement-container") || document.body;
  safeAppend(container, el);
  autoRemove(el, 8000);
}



/* ─────────────────────────────
   NOTIFICATIONS
───────────────────────────── */

function initNotifications() {

  if (unsubs.notifications) return;

  const start = Timestamp.now();

  const makeQuery = userVal => query(
    collection(db, "notifications"),
    where("target", "in", ["all", userVal]),
    limit(10)
  );

  const handle = snap => {
    snap.docChanges().forEach(change => {

      if (change.type !== "added") return;

      const id = change.doc.id;
      const d  = change.doc.data();

      if (d.createdAt && d.createdAt.toMillis() < start.toMillis()) return;
      if (seen.notifications.has(id)) return;

      fireNotification(d.title, d.body);
      markSeen("notifications", id); // FIX-P: after render

      updateDoc(doc(db, "notifications", id), { read: true });
    });
  };

  const err = e => console.warn("[Notifications]", e);

  const unsubAll  = onSnapshot(makeQuery("all"), handle, err);
  let   unsubUser = () => {};
  if (CURRENT_USER) {
    unsubUser = onSnapshot(makeQuery(CURRENT_USER), handle, err);
  }

  unsubs.notifications = () => { unsubAll(); unsubUser(); };
}

function fireNotification(title, body) {
  if (Notification.permission !== "granted") return;
  const opts = { body, icon: "/icon-192.png", badge: "/icon-192.png" };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then(r => r.showNotification(title, opts));
  } else {
    try { new Notification(title, opts); } catch {}
  }
}



/* ─────────────────────────────
   PROMOTIONS
   FIX-M: use data.body not data.message
   FIX-N: reuse #promoPopup, setProperty !important
   FIX-P: markSeen after render
───────────────────────────── */

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
      if (!data.title && !data.body) return;

      renderPromotion(data);
      markSeen("promotions", id); // FIX-P: after render
    });

  }, err => console.warn("[Promotions]", err));
}

function renderPromotion(data) {

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

  popup.addEventListener("click", function handler(e) {
    if (e.target === popup) {
      popup.style.setProperty("display", "none", "important");
      popup.removeEventListener("click", handler);
    }
  });

  setTimeout(() => {
    popup.style.setProperty("display", "none", "important");
  }, (data.duration || 8) * 1000);
}



/* ─────────────────────────────
   APP UPDATES
   FIX-R: listener was completely missing
   FIX-S: version+time key stored in sessionStorage to prevent re-show
───────────────────────────── */

let _lastUpdateKey = null;

function initAppUpdates() {

  if (unsubs.updates) return;

  unsubs.updates = onSnapshot(
    doc(db, "appUpdates", "latest"),
    snap => {

      if (!snap.exists()) return;

      const data = snap.data();

      if (!data.active) return;

      // Unique key — version + time so re-pushing same version still shows
      const key = (data.version || "") + "_" + (data.time || "");

      // In-memory guard (resets on page reload — intentional so new pushes always show)
      if (_lastUpdateKey === key) return;

      // Session guard — survives bfcache but resets on full reload
      if (sessionStorage.getItem(SK.UPDATE_SEEN) === key) return;

      _lastUpdateKey = key;
      sessionStorage.setItem(SK.UPDATE_SEEN, key);

      showUpdatePopup(data);
    },
    err => console.warn("[AppUpdates]", err)
  );
}

function showUpdatePopup(data) {

  const isForced = data.type === "forced";

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    display:flex;
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.85);
    backdrop-filter:blur(12px);
    align-items:center;
    justify-content:center;
    z-index:999999;
  `;

  overlay.innerHTML = `
    <div style="
      background:#0d1117;
      border:1px solid rgba(0,224,255,0.3);
      border-radius:20px;
      padding:32px 28px 28px;
      max-width:360px;width:90%;
      text-align:center;color:#eef0ff;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
    ">
      <div style="font-size:48px;margin-bottom:12px;">🚀</div>
      <h2 style="font-size:20px;font-weight:700;margin:0 0 6px;color:#fff;">Update Available</h2>
      <p style="font-size:13px;color:#7c5cfc;font-weight:600;margin:0 0 16px;">${data.version || ""}</p>
      ${data.changelog ? `
      <pre style="
        text-align:left;font-size:12px;color:#94a3b8;
        background:#060910;padding:14px;border-radius:10px;
        margin:0 0 20px;white-space:pre-wrap;line-height:1.6;
        max-height:160px;overflow-y:auto;
      ">${data.changelog}</pre>` : ""}
      <button id="uwUpdateBtn" style="
        display:block;width:100%;
        background:linear-gradient(135deg,#00e0ff,#7c5cfc);
        border:none;border-radius:12px;padding:14px;
        color:#000;font-weight:700;font-size:15px;cursor:pointer;
        margin-bottom:${isForced ? "0" : "10px"};
      ">Update App</button>
      ${!isForced ? `
      <button id="uwDismissBtn" style="
        background:none;border:none;
        color:#4a5568;font-size:13px;
        cursor:pointer;padding:6px;
      ">Maybe later</button>` : ""}
    </div>
  `;

  safeAppend(document.body, overlay);

  document.getElementById("uwUpdateBtn").onclick = async () => {
    const btn = document.getElementById("uwUpdateBtn");
    if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    setTimeout(() => location.reload(true), 800);
  };

  const dismissBtn = document.getElementById("uwDismissBtn");
  if (dismissBtn) dismissBtn.onclick = () => overlay.remove();
}



/* ─────────────────────────────
   BOOT
───────────────────────────── */

function boot() {

  console.log("[UW] boot");

  initServiceWorker();

  if (sessionStorage.getItem(SK.LISTENERS_BOOT) === "1") return;
  sessionStorage.setItem(SK.LISTENERS_BOOT, "1");

  initAnnouncements();
  initNotifications();
  initPromotions();
  initAppUpdates();
}

document.addEventListener("DOMContentLoaded", boot);

window.addEventListener("pageshow", e => {
  if (e.persisted) {
    sessionStorage.removeItem(SK.LISTENERS_BOOT);
    boot();
  }
});

// FIX-S: null every unsub ref AFTER calling it
// Without this, bfcache restore sets LISTENERS_BOOT="" and re-calls boot(),
// but initX() sees truthy unsubs.x and returns early — no listeners attached.
window.addEventListener("pagehide", () => {

  if (typeof unsubs.announcements === "function") { unsubs.announcements(); unsubs.announcements = null; }
  if (typeof unsubs.notifications  === "function") { unsubs.notifications();  unsubs.notifications  = null; }
  if (typeof unsubs.promotions     === "function") { unsubs.promotions();     unsubs.promotions     = null; }
  if (typeof unsubs.updates        === "function") { unsubs.updates();        unsubs.updates        = null; }

  sessionStorage.removeItem(SK.LISTENERS_BOOT);
});
