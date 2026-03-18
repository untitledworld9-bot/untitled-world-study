/**
 * index.js — Untitled World (FINAL)
 *
 * FIX-I   announcements composite index error
 * FIX-J   notifications query safe
 * FIX-K   bfcache restore
 * FIX-M   promotions body field fix
 * FIX-P   markSeen poisoning fix — markSeen called AFTER render
 * FIX-Q   service worker reload loop removed
 * FIX-R   App Updates listener added
 * FIX-S   pagehide NULLS unsubs after calling
 * FIX-T   Announcements: edtech-style banner, priority colour, image, close btn
 * FIX-U   Notifications: localStorage dedup so same notification never repeats
 * FIX-V   Promotions banner type: CENTERED OVERLAY MODAL (not top banner)
 *          Popup type: centered overlay (existing behaviour)
 * FIX-W   Promotions CTA: if data.url exists → open URL in new tab, then close
 * FIX-X   App Updates: if data.url exists → open URL instead of cache-clear reload
 * FIX-Y   Promotions: setTimeout removed — show immediately when Firestore fires
 * FIX-Z   Announcements + Promotions: sessionStorage → re-appear each fresh session
 * FIX-AA  App Updates: localStorage → NEVER repeat across sessions
 * FIX-AB  Announcement medium priority: darker background
 * FIX-AC  Notifications: createdAt guard — only NEW notifications fire
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
   STORAGE KEYS
───────────────────────────── */

const SK = {
  ANNOUNCEMENTS : "uw_seen_announcements",
  NOTIFICATIONS : "uw_seen_notifications",
  PROMOTIONS    : "uw_seen_promotions",
  VIDEO_PROMOS  : "uw_seen_videopromos",
  UPDATE_SEEN   : "uw_seen_update",
  MAINTENANCE   : "uw_maintenance_active",
  LISTENERS_BOOT: "uw_listeners_booted"
};

// FIX-Z:  Announcements & Promotions use sessionStorage (fresh on each app open)
// FIX-AC: Notifications use localStorage (permanent dedup — no old notifs ever replay)
const seen = {
  announcements : new Set(JSON.parse(sessionStorage.getItem(SK.ANNOUNCEMENTS) || "[]")),
  notifications : new Set(JSON.parse(localStorage.getItem(SK.NOTIFICATIONS)   || "[]")),
  promotions    : new Set(JSON.parse(sessionStorage.getItem(SK.PROMOTIONS)    || "[]")),
  // BAAD MEIN (localStorage — kabhi repeat nahi)
videoPromos : new Set(JSON.parse(localStorage.getItem(SK.VIDEO_PROMOS)  || "[]"))
};

function markSeen(type, id) {
  seen[type].add(id);
  try {
    // notifications → localStorage (permanent); everything else → sessionStorage
    // BAAD MEIN
const storage = (type === "notifications" || type === "videoPromos") ? localStorage : sessionStorage;
    storage.setItem(SK[type.toUpperCase()], JSON.stringify([...seen[type]]));
  } catch {}
}

const CURRENT_USER = localStorage.getItem("userName") || null;

const unsubs = {
  announcements : null,
  notifications : null,
  promotions    : null,
  updates       : null,
  videoPromos   : null,
  maintenance   : null
};

// ── Which page are we on? Used for page-targeted promos/announcements
function getCurrentPage() {
  const path = window.location.pathname.toLowerCase();
  if (path.includes("timer")) return "timer";
  return "home"; // index.html = "home"
}


/* ─────────────────────────────
   HELPERS
───────────────────────────── */

function qs(s, r = document) { try { return r.querySelector(s); } catch { return null; } }
function safeAppend(p, c)    { if (p && c) p.appendChild(c); }
function autoRemove(el, ms)  { setTimeout(() => { if (el?.parentNode) el.remove(); }, ms); }

function showToast(html, duration = 5000) {
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed;bottom:24px;right:20px;
    background:#1e3a5f;color:#e2f0ff;
    padding:14px 20px;border-radius:14px;
    font-size:14px;font-weight:600;
    box-shadow:0 6px 20px rgba(0,0,0,0.5);
    z-index:99999;max-width:300px;
    border:1px solid rgba(0,242,254,0.25);
    line-height:1.5;
  `;
  t.innerHTML = html;
  safeAppend(document.body, t);
  autoRemove(t, duration);
}

function isPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}


/* ─────────────────────────────
   KEYFRAME ANIMATIONS (injected once)
───────────────────────────── */

(function injectAnimations() {
  if (document.getElementById("uw-animations")) return;
  const style = document.createElement("style");
  style.id = "uw-animations";
  style.textContent = `
    @keyframes slideDown {
      from { transform:translateY(-16px); opacity:0; }
      to   { transform:translateY(0);     opacity:1; }
    }
    @keyframes slideUp {
      from { transform:translateY(28px) scale(0.97); opacity:0; }
      to   { transform:translateY(0)    scale(1);    opacity:1; }
    }
    @keyframes fadeIn {
      from { opacity:0; }
      to   { opacity:1; }
    }
  `;
  document.head.appendChild(style);
})();


/* ─────────────────────────────
   SERVICE WORKER
───────────────────────────── */

function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/firebase-messaging-sw.js");
  navigator.serviceWorker.register("/sw.js");
}


/* ─────────────────────────────
   ANNOUNCEMENTS
   FIX-Z:  sessionStorage → re-appears on every fresh app open
   FIX-AB: medium priority has darker background (0.22 vs old 0.12)
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

      if (!data.active)                      return;
      if (seen.announcements.has(id))        return;
      if (data.target === "pwa" && !isPWA()) return;
      // Page targeting: only show if page matches or is "all"
      const curPage = getCurrentPage();
      if (data.page && data.page !== "all" && data.page !== curPage) return;

      renderAnnouncement(data);
      markSeen("announcements", id);
    });
  }, err => console.warn("[Announcements]", err));
}

function renderAnnouncement(data) {
  // FIX-AB: medium bg darker (0.22 opacity instead of 0.12)
  const colours = {
    high   : { bg: "rgba(255,59,59,0.18)",  border: "#ff3b3b", dot: "#ff3b3b" },
    medium : { bg: "rgba(255,184,48,0.22)", border: "#ffb830", dot: "#ffb830" },
    low    : { bg: "rgba(0,229,160,0.14)",  border: "#00e5a0", dot: "#00e5a0" }
  };
  const c = colours[data.priority] || colours.medium;

  const el = document.createElement("div");
  el.style.cssText = `
    position:relative;width:100%;
    background:${c.bg};
    border-left:4px solid ${c.border};
    border-radius:0 12px 12px 0;
    padding:14px 44px 14px 18px;
    display:flex;align-items:flex-start;gap:12px;
    animation:slideDown .35s ease;font-family:inherit;
  `;

  const dot = document.createElement("span");
  dot.style.cssText = `
    flex-shrink:0;width:10px;height:10px;
    border-radius:50%;background:${c.dot};
    margin-top:5px;box-shadow:0 0 8px ${c.dot};
  `;

  const wrap = document.createElement("div");
  wrap.style.cssText = "flex:1;min-width:0;";

  if (data.imageUrl) {
    const img = document.createElement("img");
    img.src = data.imageUrl;
    img.alt = "";
    img.style.cssText = `
      width:100%;max-height:180px;object-fit:cover;
      border-radius:8px;margin-bottom:10px;display:block;
    `;
    img.onerror = () => img.remove();
    wrap.appendChild(img);
  }

  const msg = document.createElement("div");
  msg.style.cssText = "font-size:15px;font-weight:600;color:#e2f0ff;line-height:1.5;";
  msg.textContent = (data.text || "").replace(/^📢\s*/, "");

  const meta = document.createElement("div");
  meta.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);margin-top:4px;";
  meta.textContent = "📢 Untitled World";

  wrap.appendChild(msg);
  wrap.appendChild(meta);

  const close = document.createElement("button");
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.style.cssText = `
    position:absolute;top:10px;right:12px;
    background:none;border:none;
    color:rgba(255,255,255,0.45);
    font-size:16px;cursor:pointer;
    line-height:1;padding:2px 4px;
  `;
  close.onclick = () => el.remove();

  el.appendChild(dot);
  el.appendChild(wrap);
  el.appendChild(close);

  safeAppend(qs("#announcement-container") || document.body, el);
  autoRemove(el, 8000);
}


/* ─────────────────────────────
   NOTIFICATIONS
   FIX-AC: createdAt guard — only notifications created AFTER boot fire
           localStorage dedup — old notifications never replay, ever
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

      // FIX-AC: only fire if notification was created AFTER this session started
      if (d.createdAt && d.createdAt.toMillis() < start.toMillis()) return;
      // Permanent localStorage dedup — never shows same notification twice
      if (seen.notifications.has(id)) return;

      fireNotification(d.title, d.body, d.url || null);
      markSeen("notifications", id);
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

function fireNotification(title, body, url) {
  if (Notification.permission !== "granted") return;
  const opts = {
    body,
    icon  : "/icon-192.png",
    badge : "/icon-192.png",
    data  : { url: url || "/" }
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then(r => r.showNotification(title, opts));
  } else {
    try { new Notification(title, opts); } catch {}
  }
}


/* ─────────────────────────────
   PROMOTIONS
   FIX-V:  Banner = CENTERED OVERLAY MODAL (not top-fixed banner)
           Full image at top, title+body+CTA below, ✕ at top-right corner
   FIX-W:  CTA → open data.url in new tab if present, then close
   FIX-Y:  3-second delay before showing
   FIX-Z:  sessionStorage dedup → re-appears on each new session
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

      if (seen.promotions.has(id))   return;
      if (!data.title && !data.body) return;
      // Page targeting: only show if page matches or is "all"
      const curPage = getCurrentPage();
      if (data.page && data.page !== "all" && data.page !== curPage) return;

      // Mark seen immediately so duplicate Firestore events don't double-show
      markSeen("promotions", id);

      // Show immediately — Firestore connection itself has natural 2-4s delay
      if (data.type === "banner") {
        renderPromotionBanner(data);
      } else {
        renderPromotionPopup(data);
      }
    });
  }, err => console.warn("[Promotions]", err));
}

// ── BANNER — FIX-V: CENTERED OVERLAY MODAL (like the screenshot edtech style)
function renderPromotionBanner(data) {
  // Full-screen dim backdrop
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(0,0,0,0.82);
    backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;
    z-index:99998;
    animation:fadeIn .3s ease;
    font-family:inherit;
  `;

  // Centered card
  const card = document.createElement("div");
  card.style.cssText = `
    position:relative;
    width:90%;max-width:420px;
    background:${data.bgColor || "#0d1117"};
    border:1px solid rgba(0,242,254,0.25);
    border-radius:20px;
    overflow:hidden;
    box-shadow:0 24px 60px rgba(0,0,0,0.75);
    animation:slideUp .35s ease;
  `;

  // ✕ Close — top-right corner of card
  const close = document.createElement("button");
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.style.cssText = `
    position:absolute;top:12px;right:12px;
    background:rgba(0,0,0,0.55);
    border:none;border-radius:50%;
    color:#fff;font-size:14px;
    width:30px;height:30px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;z-index:3;line-height:1;
  `;
  close.onclick = () => overlay.remove();
  card.appendChild(close);

  // Full-width image at top
  if (data.imageUrl) {
    const img = document.createElement("img");
    img.src = data.imageUrl;
    img.alt = data.title || "";
    img.style.cssText = `
      width:100%;max-height:220px;
      object-fit:cover;display:block;
    `;
    img.onerror = () => img.remove();
    card.appendChild(img);
  }

  // Content block below image
  const content = document.createElement("div");
  content.style.cssText = "padding:20px 20px 24px;text-align:center;";

  if (data.title) {
    const t = document.createElement("div");
    t.style.cssText = `
      font-size:17px;font-weight:700;
      color:#fff;line-height:1.4;margin-bottom:8px;
    `;
    t.textContent = data.title;
    content.appendChild(t);
  }

  if (data.body) {
    const b = document.createElement("div");
    b.style.cssText = `
      font-size:13px;
      color:rgba(255,255,255,0.60);
      line-height:1.6;margin-bottom:18px;
    `;
    b.textContent = data.body;
    content.appendChild(b);
  }

  if (data.cta) {
    const btn = document.createElement("button");
    btn.textContent = data.cta;
    btn.style.cssText = `
      display:inline-block;
      background:linear-gradient(45deg,#00f2fe,#4facfe);
      border:none;border-radius:24px;
      padding:12px 36px;
      color:#000;font-weight:700;
      cursor:pointer;font-size:14px;
      white-space:nowrap;
    `;
    // FIX-W: open URL then close
    btn.onclick = () => {
      if (data.url) window.open(data.url, "_blank");
      overlay.remove();
    };
    content.appendChild(btn);
  }

  card.appendChild(content);
  overlay.appendChild(card);

  // Close on backdrop tap
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  safeAppend(document.body, overlay);

  // Auto-hide after admin-set duration (default 8s)
  const ms = (data.duration || 8) * 1000;
  if (ms > 0) autoRemove(overlay, ms);
}

// ── POPUP — centered overlay (reuses #promoPopup, unchanged)
function renderPromotionPopup(data) {
  const popup = document.getElementById("promoPopup");
  if (!popup) return;

  const box = popup.querySelector(".promo-box");
  if (!box) return;

  box.innerHTML = "";

  const closeBtn = document.createElement("span");
  closeBtn.className = "promo-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => popup.style.setProperty("display", "none", "important");

  const titleEl = document.createElement("h3");
  titleEl.style.cssText = "color:#fff;margin:16px 0 10px;font-size:18px;font-weight:700;padding:0 10px;";
  titleEl.textContent = data.title || "";

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
      border:none;border-radius:20px;padding:10px 28px;
      color:#fff;font-weight:600;cursor:pointer;font-size:14px;
    `;
    btn.textContent = data.cta;
    // FIX-W: open URL if present
    btn.onclick = () => {
      if (data.url) window.open(data.url, "_blank");
      popup.style.setProperty("display", "none", "important");
    };
    box.appendChild(btn);
  }

  popup.style.setProperty("display", "flex", "important");

  popup.addEventListener("click", function handler(e) {
    if (e.target === popup) {
      popup.style.setProperty("display", "none", "important");
      popup.removeEventListener("click", handler);
    }
  });

  const ms = (data.duration || 8) * 1000;
  if (ms > 0) setTimeout(() => popup.style.setProperty("display", "none", "important"), ms);
}


/* ─────────────────────────────
   VIDEO PROMOTIONS
   Admin can send a video promo (YouTube/Shorts/any URL).
   Video pops up after admin-set delay and auto-closes after duration.
───────────────────────────── */

function getVideoEmbedUrl(url) {
  if (!url) return null;
  // YouTube watch / shorts / youtu.be
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&?/\s]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=0&rel=0`;
  // Fallback — embed the URL directly (works for mp4, Vimeo, etc.)
  return url;
}

function initVideoPromos() {
  if (unsubs.videoPromos) return;

  const curPage = getCurrentPage();

  // Try with active==true filter first; fall back silently on permission errors
  const q = query(
    collection(db, "videoPromotions"),
    where("active", "==", true),
    limit(3)
  );

  const handleSnap = snap => {
    snap.docChanges().forEach(change => {
      if (change.type !== "added") return;

      const id   = change.doc.id;
      const data = change.doc.data();

      if (!data.active)              return;
      if (seen.videoPromos.has(id))  return;
      // Page targeting
      if (data.page && data.page !== "all" && data.page !== curPage) return;

      markSeen("videoPromos", id);

      const delay = (data.delay || 0) * 1000;
      setTimeout(() => showVideoPromo(data), delay);
    });
  };

  const handleErr = err => {
    // permission-denied = rules not yet updated — fail silently, no spam in console
    if (err.code === "permission-denied") {
      // VideoPromotions collection not yet whitelisted in Firestore rules — skip silently
      return;
    }
    console.warn("[VideoPromos]", err);
  };

  try {
    const unsub = onSnapshot(q, handleSnap, handleErr);
    unsubs.videoPromos = unsub;
  } catch (e) {
    // Catch any synchronous errors (shouldn't happen but belt-and-braces)
  }
}

function showVideoPromo(data) {
  const embedUrl = getVideoEmbedUrl(data.videoUrl || "");
  if (!embedUrl) return;

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(0,0,0,0.88);
    backdrop-filter:blur(8px);
    display:flex;align-items:center;justify-content:center;
    z-index:999997;
    animation:fadeIn .35s ease;
    font-family:inherit;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    position:relative;
    width:92%;max-width:480px;
    background:#0d1117;
    border:1px solid rgba(0,242,254,0.22);
    border-radius:20px;
    overflow:hidden;
    box-shadow:0 24px 60px rgba(0,0,0,0.8);
    animation:slideUp .35s ease;
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText = `
    position:absolute;top:10px;right:10px;
    background:rgba(0,0,0,0.6);
    border:none;border-radius:50%;
    color:#fff;font-size:14px;
    width:30px;height:30px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;z-index:5;line-height:1;
  `;
  closeBtn.onclick = () => overlay.remove();
  card.appendChild(closeBtn);

  // Video iframe
  const videoWrap = document.createElement("div");
  videoWrap.style.cssText = `
    position:relative;width:100%;padding-bottom:56.25%;
    background:#000;
  `;
  const iframe = document.createElement("iframe");
  iframe.src = embedUrl;
  iframe.style.cssText = `
    position:absolute;inset:0;width:100%;height:100%;
    border:none;
  `;
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
  videoWrap.appendChild(iframe);
  card.appendChild(videoWrap);

  // Content below video
  const content = document.createElement("div");
  content.style.cssText = "padding:16px 20px 20px;text-align:center;";

  if (data.title) {
    const t = document.createElement("div");
    t.style.cssText = "font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;";
    t.textContent = data.title;
    content.appendChild(t);
  }

  if (data.body) {
    const b = document.createElement("div");
    b.style.cssText = "font-size:13px;color:rgba(255,255,255,0.55);line-height:1.5;margin-bottom:14px;";
    b.textContent = data.body;
    content.appendChild(b);
  }

  if (data.cta) {
    const btn = document.createElement("button");
    btn.textContent = data.cta;
    btn.style.cssText = `
      background:linear-gradient(45deg,#00f2fe,#4facfe);
      border:none;border-radius:20px;
      padding:10px 30px;color:#000;
      font-weight:700;cursor:pointer;font-size:14px;
    `;
    btn.onclick = () => {
      if (data.ctaUrl) window.open(data.ctaUrl, "_blank");
      overlay.remove();
    };
    content.appendChild(btn);
  }

  card.appendChild(content);
  overlay.appendChild(card);

  // Close on backdrop tap
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  safeAppend(document.body, overlay);

  // Auto-close after duration (0 = stays until closed)
  const ms = (data.duration || 0) * 1000;
  if (ms > 0) autoRemove(overlay, ms);
}


/* ─────────────────────────────
   MAINTENANCE ANNOUNCEMENT
   Admin can push a maintenance popup that:
   - Appears immediately on every app open (no dismiss button)
   - Has admin-set duration (0 = stays until admin deletes it)
   - Removed from display only when admin deletes the document
───────────────────────────── */

let _maintenanceOverlay = null;
let _maintenanceTimer   = null;

function initMaintenance() {
  if (unsubs.maintenance) return;

  unsubs.maintenance = onSnapshot(
    doc(db, "maintenance", "current"),
    snap => {
      if (!snap.exists()) {
        // Admin deleted maintenance — remove overlay immediately
        removeMaintenance();
        return;
      }
      const data = snap.data();
      if (!data.active) {
        removeMaintenance();
        return;
      }
      // Show if not already showing
      if (!_maintenanceOverlay) {
        showMaintenancePopup(data);
      }
    },
    err => console.warn("[Maintenance]", err)
  );
}

function removeMaintenance() {
  if (_maintenanceTimer) { clearTimeout(_maintenanceTimer); _maintenanceTimer = null; }
  if (_maintenanceOverlay) { _maintenanceOverlay.remove(); _maintenanceOverlay = null; }
}

function showMaintenancePopup(data) {
  // Remove any existing overlay first
  removeMaintenance();

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed;inset:0;
    background:rgba(0,8,28,0.92);
    backdrop-filter:blur(18px) saturate(1.6);
    -webkit-backdrop-filter:blur(18px) saturate(1.6);
    display:flex;align-items:center;justify-content:center;
    z-index:9999999;
    font-family:inherit;
    padding:20px;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    position:relative;
    width:100%;max-width:400px;
    background:linear-gradient(145deg,rgba(0,30,80,0.95),rgba(0,10,40,0.98));
    border:1px solid rgba(0,180,255,0.35);
    border-radius:24px;
    padding:36px 28px 32px;
    text-align:center;
    box-shadow:
      0 0 0 1px rgba(0,180,255,0.12),
      0 24px 80px rgba(0,0,0,0.8),
      0 0 60px rgba(0,100,255,0.15),
      inset 0 1px 0 rgba(255,255,255,0.07);
    animation:uwMaintSlideUp .45s cubic-bezier(.16,1,.3,1) both;
  `;

  // Pulsing icon
  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = `
    width:72px;height:72px;border-radius:50%;
    background:linear-gradient(135deg,rgba(0,100,255,0.25),rgba(0,200,255,0.15));
    border:1px solid rgba(0,180,255,0.3);
    display:flex;align-items:center;justify-content:center;
    margin:0 auto 20px;
    font-size:32px;
    box-shadow:0 0 30px rgba(0,150,255,0.2);
    animation:uwMaintPulse 2.5s ease infinite;
  `;
  iconWrap.textContent = "🔧";

  // Heading
  const heading = document.createElement("div");
  heading.style.cssText = `
    font-size:20px;font-weight:800;
    background:linear-gradient(135deg,#60c8ff,#a0e4ff);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
    background-clip:text;
    margin-bottom:6px;letter-spacing:-0.02em;line-height:1.3;
  `;
  heading.textContent = data.heading || "🔧 App Under Maintenance";

  // Subtitle
  const subtitle = document.createElement("div");
  subtitle.style.cssText = `
    font-size:11px;font-weight:700;letter-spacing:.18em;
    text-transform:uppercase;color:rgba(100,200,255,0.55);
    margin-bottom:20px;
  `;
  subtitle.textContent = "SCHEDULED MAINTENANCE";

  // Divider
  const divider = document.createElement("div");
  divider.style.cssText = `
    height:1px;
    background:linear-gradient(90deg,transparent,rgba(0,180,255,0.3),transparent);
    margin-bottom:20px;
  `;

  // Admin message
  const msg = document.createElement("div");
  msg.style.cssText = `
    font-size:14px;line-height:1.7;
    color:rgba(180,220,255,0.85);
    margin-bottom:24px;white-space:pre-wrap;
  `;
  msg.textContent = data.message || "We are working to make the app better.\nWe will be coming back soon 🚀";

  // Duration badge (if set)
  if (data.durationMinutes && data.durationMinutes > 0) {
    const badge = document.createElement("div");
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(0,150,255,0.12);
      border:1px solid rgba(0,150,255,0.25);
      border-radius:99px;padding:5px 14px;
      font-size:12px;font-weight:600;color:rgba(150,210,255,0.8);
      margin-bottom:0;
    `;
    badge.textContent = `⏱ Est. ${data.durationMinutes} min`;
    card.appendChild(iconWrap);
    card.appendChild(heading);
    card.appendChild(subtitle);
    card.appendChild(divider);
    card.appendChild(msg);
    card.appendChild(badge);
  } else {
    card.appendChild(iconWrap);
    card.appendChild(heading);
    card.appendChild(subtitle);
    card.appendChild(divider);
    card.appendChild(msg);
  }

  overlay.appendChild(card);

  // Inject keyframes
  if (!document.getElementById("uw-maintenance-anim")) {
    const s = document.createElement("style");
    s.id = "uw-maintenance-anim";
    s.textContent = `
      @keyframes uwMaintSlideUp {
        from { transform:translateY(32px) scale(0.96); opacity:0; }
        to   { transform:translateY(0) scale(1); opacity:1; }
      }
      @keyframes uwMaintPulse {
        0%,100% { box-shadow:0 0 30px rgba(0,150,255,0.2); }
        50%      { box-shadow:0 0 50px rgba(0,150,255,0.45); }
      }
    `;
    document.head.appendChild(s);
  }

  safeAppend(document.body, overlay);
  _maintenanceOverlay = overlay;

  // Auto-remove after duration (if set)
  const ms = (data.durationMinutes || 0) * 60 * 1000;
  if (ms > 0) {
    _maintenanceTimer = setTimeout(() => removeMaintenance(), ms);
  }
}




let _lastUpdateKey = null;

function initAppUpdates() {
  if (unsubs.updates) return;

  unsubs.updates = onSnapshot(
    doc(db, "appUpdates", "latest"),
    snap => {
      if (!snap.exists()) return;

      const data = snap.data();
      if (!data.active) return;

      const key = (data.version || "") + "_" + (data.time || "");
      if (_lastUpdateKey === key) return;
      // FIX-AA: localStorage — same update version never shown again
      if (localStorage.getItem(SK.UPDATE_SEEN) === key) return;

      _lastUpdateKey = key;
      localStorage.setItem(SK.UPDATE_SEEN, key);
      showUpdatePopup(data);
    },
    err => console.warn("[AppUpdates]", err)
  );
}

function showUpdatePopup(data) {
  const isForced = data.type === "forced";

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    display:flex;position:fixed;inset:0;
    background:rgba(0,0,0,.85);backdrop-filter:blur(12px);
    align-items:center;justify-content:center;z-index:999999;
  `;

  overlay.innerHTML = `
    <div style="
      background:#0d1117;border:1px solid rgba(0,224,255,0.3);
      border-radius:20px;padding:32px 28px 28px;
      max-width:360px;width:90%;text-align:center;color:#eef0ff;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
    ">
      <div style="font-size:48px;margin-bottom:12px;">🚀</div>
      <h2 style="font-size:20px;font-weight:700;margin:0 0 6px;color:#fff;">Update Available</h2>
      <p style="font-size:13px;color:#7c5cfc;font-weight:600;margin:0 0 16px;">${data.version || ""}</p>
      ${data.changelog ? `<pre style="
        text-align:left;font-size:12px;color:#94a3b8;
        background:#060910;padding:14px;border-radius:10px;
        margin:0 0 20px;white-space:pre-wrap;line-height:1.6;
        max-height:160px;overflow-y:auto;">${data.changelog}</pre>` : ""}
      <button id="uwUpdateBtn" style="
        display:block;width:100%;
        background:linear-gradient(135deg,#00e0ff,#7c5cfc);
        border:none;border-radius:12px;padding:14px;
        color:#000;font-weight:700;font-size:15px;cursor:pointer;
        margin-bottom:${isForced ? "0" : "10px"};
      ">Update App</button>
      ${!isForced ? `<button id="uwDismissBtn" style="
        background:none;border:none;color:#4a5568;font-size:13px;
        cursor:pointer;padding:6px;">Maybe later</button>` : ""}
    </div>
  `;

  safeAppend(document.body, overlay);

  // FIX-X: if data.url → open URL; otherwise cache-clear + reload
  document.getElementById("uwUpdateBtn").onclick = async () => {
    const btn = document.getElementById("uwUpdateBtn");
    if (btn) { btn.textContent = "Updating…"; btn.disabled = true; }

    if (data.url) {
      window.open(data.url, "_blank");
      overlay.remove();
      return;
    }

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
  initVideoPromos();
  initMaintenance();
}

// FIX-FAST: call boot() immediately — no waiting for DOMContentLoaded
// Firestore listeners register instantly; renders happen when data arrives
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot(); // DOM already ready (module scripts run after parse)
}

window.addEventListener("pageshow", e => {
  if (e.persisted) {
    sessionStorage.removeItem(SK.LISTENERS_BOOT);
    boot();
  }
});

window.addEventListener("pagehide", () => {
  if (typeof unsubs.announcements === "function") { unsubs.announcements(); unsubs.announcements = null; }
  if (typeof unsubs.notifications  === "function") { unsubs.notifications();  unsubs.notifications  = null; }
  if (typeof unsubs.promotions     === "function") { unsubs.promotions();     unsubs.promotions     = null; }
  if (typeof unsubs.updates        === "function") { unsubs.updates();        unsubs.updates        = null; }
  if (typeof unsubs.videoPromos    === "function") { unsubs.videoPromos();    unsubs.videoPromos    = null; }
  if (typeof unsubs.maintenance    === "function") { unsubs.maintenance();    unsubs.maintenance    = null; }
  sessionStorage.removeItem(SK.LISTENERS_BOOT);
});
