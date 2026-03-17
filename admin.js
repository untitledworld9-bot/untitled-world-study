/**
 * ============================================================
 *  Untitled World Admin Panel — admin.js
 *  Production-grade real-time admin system
 *
 *  Features:
 *   - Firebase Auth gate + secret code check (7905)
 *   - Live Firestore listeners (onSnapshot) for all sections
 *   - Real-time user tracking (online / focusing / offline)
 *   - Live chat logs with search & room filter
 *   - Announcement system (instant PWA delivery)
 *   - Promotion system (popup / banner / modal)
 *   - App update pusher
 *   - Push notification queue
 *   - Chart.js analytics
 *   - Toast notification system
 * ============================================================
 */

// ── IMPORTANT: Adjust this import path to match your firebase.js location
import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  Timestamp
} from "./firebase.js";

// ============================================================
//  CONSTANTS
// ============================================================

/** The secret admin access code shown on the auth gate */
const ADMIN_CODE = "7905";

/** Authorised admin email addresses (add more as needed) */
const ADMIN_EMAILS = [
 "untitledworld9@gmail.com",
 "ayushgupt640@gmail.com"
  // Add additional admin emails here
];

/** Firestore collection names — centralised for easy renaming */
const COLL = {
  USERS:         "users",
  MESSAGES:      "messages",
  ROOMS:         "rooms",
  ANNOUNCEMENTS: "announcements",
  PROMOTIONS:    "promotions",
  UPDATES:       "appUpdates",
  NOTIFICATIONS: "notifications",
  ANALYTICS:     "analytics"
};

// ============================================================
//  STATE — single source of truth for all live data
// ============================================================

const STATE = {
  allUsers:    [],    // full user list from Firestore
  allMessages: [],    // full message list from Firestore
  rooms:       [],    // active room names (for filter dropdown)
  charts:      {},    // Chart.js instances
  unsubscribers: [],  // Firestore listener cleanup functions
  promoType:   "popup"
};

// ============================================================
//  DOM HELPERS
// ============================================================

/** Safely get an element by ID */
const $  = id => document.getElementById(id);

/** Animate a stat counter when its value changes */
function animateStat(el, newVal) {
  if (!el) return;
  if (el.innerText === String(newVal)) return; // no change, skip
  el.classList.remove("value-flash");
  void el.offsetWidth; // reflow to restart animation
  el.innerText = newVal;
  el.classList.add("value-flash");
}

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================

/**
 * Show a floating toast message.
 * @param {string} message  Display text
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number}  duration  ms before auto-dismiss (default 3500)
 */
function toast(message, type = "info", duration = 3500) {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  const container = $("toastContainer");

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span>
                  <span class="toast-text">${message}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove());
  }, duration);
}

// ============================================================
//  MODAL HELPERS
// ============================================================

let _modalResolve = null;

/**
 * Open a confirmation modal and return a Promise<boolean>.
 * true = user confirmed, false = user cancelled.
 */
function confirmModal(title, body) {
  return new Promise(resolve => {
    _modalResolve = resolve;
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent  = body;
    $("confirmModal").classList.add("open");
    // FIX-DELETE: closeModal() was resolving promise as false BEFORE resolve(true) ran
    // So delete/action always got yes=false and never executed.
    $("confirmOkBtn").onclick = () => {
      $("confirmModal").classList.remove("open");
      _modalResolve = null;
      resolve(true);
    };
  });
}

window.closeModal = () => {
  $("confirmModal").classList.remove("open");
  if (_modalResolve) { _modalResolve(false); _modalResolve = null; }
};

// ============================================================
//  SECTION NAVIGATION
// ============================================================

/**
 * Switch the visible section and update sidebar active state.
 * Exposed on window so inline onclick="showSection(...)" works.
 */
window.showSection = id => {
  // Hide all sections
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  // Show target
  const target = $(id);
  if (target) target.classList.add("active");

  // Update sidebar buttons
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === id);
  });
};

// ============================================================
//  AUTH GATE — code check + Firebase auth
// ============================================================

/**
 * Step 1: Verify the 4-digit admin access code.
 * Step 2: One-shot Firebase auth check via Promise wrapper.
 *
 * KEY FIX: onAuthStateChanged is wrapped in a Promise so it acts as
 * a single async read instead of a persistent listener. The unsub()
 * call ensures it tears down immediately after the first resolved value,
 * preventing memory leaks and duplicate initAdminPanel() calls.
 */
window.verifyAdmin = async () => {
  const code  = $("adminCodeInput").value.trim();
  const errEl = $("authError");
  const btn   = document.querySelector(".auth-btn");

  // ── Step 1: Code check (synchronous)
  if (code !== ADMIN_CODE) {
    errEl.textContent = "❌ Incorrect access code. Access denied.";
    $("adminCodeInput").value = "";
    $("adminCodeInput").focus();
    return;
  }

  // ── Loading state so the user knows something is happening
  btn.disabled    = true;
  btn.textContent = "⏳ Verifying…";
  errEl.textContent = "";

  try {
    // ── Step 2: One-shot Firebase auth check
    // Wrapping onAuthStateChanged in a Promise + instant unsub() makes it
    // behave like a single async read. It resolves the moment the Firebase
    // SDK has initialised auth state — even if that takes a few hundred ms.
    const user = await new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(
        auth,
        resolvedUser => {
          unsub();          // ← teardown immediately; prevents persistent listener
          resolve(resolvedUser);
        },
        err => {
          unsub();
          reject(err);
        }
      );
    });

    // ── Step 3: User must be signed in
    if (!user) {
      errEl.textContent = "⚠️ You must be signed in via Firebase to access this panel. Redirecting…";
      setTimeout(() => (location.href = "/"), 2500);
      return;
    }

    // ── Step 4: Email must be in the allowlist
    if (!ADMIN_EMAILS.includes(user.email)) {
      errEl.textContent = "⛔ Your account does not have admin privileges.";
      setTimeout(() => signOut(auth).then(() => (location.href = "/")), 2500);
      return;
    }

    // ── Step 5: ✅ All checks passed — hide gate, launch panel
    $("authGate").style.display = "none";
    initAdminPanel(user);

  } catch (err) {
    console.error("Admin auth error:", err);
    errEl.textContent = "🔥 Firebase error: " + err.message;
  } finally {
    // Always restore button state on any failure path
    btn.disabled    = false;
    btn.textContent = "Enter Admin Panel";
  }
};

/** Logout and return to homepage */
window.doLogout = async () => {
  const yes = await confirmModal("Logout", "Are you sure you want to sign out of the admin panel?");
  if (!yes) return;
  // Unsubscribe all Firestore listeners before leaving
  STATE.unsubscribers.forEach(u => u());
  await signOut(auth);
  location.href = "/";
};

// ============================================================
//  PANEL INITIALISATION
// ============================================================

/**
 * Called after successful auth. Sets up all real-time listeners
 * and renders the admin profile in the sidebar.
 */
function initAdminPanel(user) {
  // Sidebar admin profile
  const initials = (user.displayName || user.email || "A").charAt(0).toUpperCase();
  $("adminAvatarSidebar").textContent  = initials;
  $("adminNameSidebar").textContent    = user.displayName || "Admin";
  $("adminEmailSidebar").textContent   = user.email;

  // Initialise Chart.js charts
  initCharts();

  // Start all real-time Firestore listeners
  listenUsers();
  listenMessages();
  listenRooms();
  listenAnnouncements();
  listenPromotions();
  listenAppUpdates();
  listenNotifications();
  listenRoomsAdmin();
  listenLeaderboard();
}

// ============================================================
//  CHART.JS INITIALISATION
// ============================================================

/**
 * Build two charts on the dashboard:
 *  1. User growth (last 7 days) — line chart
 *  2. Focus activity (last 7 days) — bar chart
 *
 * Charts are seeded with placeholder data; connect to your
 * analytics/dailyStats Firestore collection to populate live data.
 */
function initCharts() {
  const chartDefaults = {
    color: "rgba(255,255,255,0.7)",
    font: { family: "'Manrope', sans-serif", size: 11 }
  };

  Chart.defaults.color          = chartDefaults.color;
  Chart.defaults.font.family    = chartDefaults.font.family;
  Chart.defaults.font.size      = chartDefaults.font.size;

  // Build last-7-days labels
  const labels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  // ── User Growth Line Chart
  const growthCtx = $("growthChart").getContext("2d");
  const growthGrad = growthCtx.createLinearGradient(0, 0, 0, 200);
  growthGrad.addColorStop(0, "rgba(0,224,255,0.25)");
  growthGrad.addColorStop(1, "rgba(0,224,255,0)");

  STATE.charts.growth = new Chart(growthCtx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "New Users",
        data: [0, 0, 0, 0, 0, 0, 0], // populated by loadDailyStats()
        borderColor: "#00e0ff",
        backgroundColor: growthGrad,
        borderWidth: 2,
        pointBackgroundColor: "#00e0ff",
        pointRadius: 4,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { maxRotation: 0 } },
        y: { grid: { color: "rgba(255,255,255,0.04)" }, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });

  // ── Focus Activity Bar Chart
  const focusCtx = $("focusChart").getContext("2d");
  const focusGrad = focusCtx.createLinearGradient(0, 0, 0, 200);
  focusGrad.addColorStop(0, "rgba(124,92,252,0.7)");
  focusGrad.addColorStop(1, "rgba(124,92,252,0.15)");

  STATE.charts.focus = new Chart(focusCtx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Focus Minutes",
        data: [0, 0, 0, 0, 0, 0, 0],
        backgroundColor: focusGrad,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { maxRotation: 0 } },
        y: { grid: { color: "rgba(255,255,255,0.04)" }, beginAtZero: true }
      }
    }
  });

  // Load analytics data into charts
  loadDailyStats();
}

/**
 * Load per-day analytics from Firestore "analytics" collection.
 * Expected document structure:
 *   analytics/{YYYY-MM-DD}: { newUsers: 0, focusMinutes: 0 }
 */
async function loadDailyStats() {
  try {
    const labels = STATE.charts.growth.data.labels;
    const growthData = [];
    const focusData  = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split("T")[0]; // "YYYY-MM-DD"
      try {
        const snap = await getDoc(doc(db, COLL.ANALYTICS, key));
        const data = snap.exists() ? snap.data() : {};
        growthData.push(data.newUsers     || 0);
        focusData.push (data.focusMinutes || 0);
      } catch {
        growthData.push(0);
        focusData.push(0);
      }
    }

    STATE.charts.growth.data.datasets[0].data = growthData;
    STATE.charts.focus.data.datasets[0].data  = focusData;
    STATE.charts.growth.update();
    STATE.charts.focus.update();
  } catch (err) {
    console.warn("Could not load analytics:", err);
  }
}

// ============================================================
//  LIVE USERS LISTENER
// ============================================================

/**
 * Real-time listener on the "users" collection.
 * Updates dashboard stats, stat cards, user table, and recent-users table.
 */
function listenUsers() {
  // Full list for user management table (ordered by lastActiveDate for index compat)
  const unsub = onSnapshot(
    query(collection(db, COLL.USERS), orderBy("lastActiveDate", "desc")),
    snap => {
      STATE.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateUserStats();
      renderUserTable();
      renderDashRecent();
      renderLeaderboardSection();
    },
    err => console.error("Users listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

/** Compute aggregate stats and update dashboard cards */
function updateUserStats() {
  const users     = STATE.allUsers;
  const total     = users.length;
  const online = users.filter(u =>
  u.status === "Online" ||
  (u.status && u.status.includes("Focusing"))
).length;

const focusing = users.filter(u =>
  u.status && u.status.includes("Focusing")
).length;
  const totalFocMin = users.reduce((sum, u) => sum + (u.focusTime || 0), 0);
  const focHours  = totalFocMin < 60
    ? `${totalFocMin}m`
    : `${Math.floor(totalFocMin / 60)}h ${totalFocMin % 60}m`;

  animateStat($("totalUsers"),    total);
  animateStat($("onlineUsers"),   online);
  animateStat($("focusingUsers"), focusing);
  animateStat($("focusTime"),     focHours);
}

/**
 * Build the full users table with current search filter applied.
 */
function renderUserTable() {
  const query = ($("userSearch")?.value || "").toLowerCase();
  const rows  = STATE.allUsers.filter(u =>
    !query ||
    (u.name  || "").toLowerCase().includes(query) ||
    (u.email || "").toLowerCase().includes(query)
  );

  const tbody = $("userTable");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">
      No users found</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-avatar-sm">${(u.name || u.email || "?")[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:13px;">${escHtml(u.name || "—")}</div>
            <div style="font-size:11px;color:var(--text-muted);">${escHtml(u.email || u.id)}</div>
          </div>
        </div>
      </td>
      <td>
        <span style="font-size:11px;color:var(--text-muted);">
          ${u.platform === "pwa" ? "📱 PWA" : u.platform === "web" ? "🖥️ Website" : "🌐 Both"}
        </span>
      </td>
      <td>${statusBadge(u.status)}</td>
      <td class="mono">${formatFocusTime(u.focusTime || 0)}</td>
      <td class="mono" style="color:var(--text-muted);">${formatTimestamp(u.lastActive)}</td>
      <td>
        <button class="btn btn-outline" style="padding:6px 12px;font-size:11px;"
                onclick="notifyUser('${escHtml(u.id)}','${escHtml(u.name || u.email || u.id)}')">
          🔔
        </button>
      </td>
    </tr>
  `).join("");
}

/** Render the mini recent-users table on the dashboard */
function renderDashRecent() {
  const tbody = $("dashRecentUsers");
  if (!tbody) return;
  const recent = STATE.allUsers.slice(0, 8);
  tbody.innerHTML = recent.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-avatar-sm">${(u.name || "?")[0].toUpperCase()}</div>
          <span style="font-size:13px;">${escHtml(u.name || "—")}</span>
        </div>
      </td>
      <td>${statusBadge(u.status)}</td>
      <td class="mono">${formatFocusTime(u.focusTime || 0)}</td>
      <td class="mono" style="color:var(--text-muted);">${formatTimestamp(u.lastActive)}</td>
    </tr>
  `).join("");
}

/** Filter users table when search input changes */
window.filterUsers = () => renderUserTable();

/** Quick-action: open notification panel pre-filled with this user */
window.notifyUser = (uid, name) => {
  showSection("notifications");
  $("notifyTarget").value = "user";
  toggleUserField();
  $("notifyUser").value = name || uid;
};

// ============================================================
//  LIVE MESSAGES LISTENER
// ============================================================

/**
 * Real-time listener on "messages" collection.
 * Updates the chat log panel and message count card.
 */
function listenMessages() {
  const unsub = onSnapshot(
    query(collection(db, COLL.MESSAGES), orderBy("time", "desc"), limit(200)),
    snap => {
      // Reverse so oldest messages are at the top
      STATE.allMessages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();

      // Update message count badge and stat card
      const total = snap.size;
      animateStat($("messagesCount"), total);
      $("msgBadge").textContent = total > 99 ? "99+" : total;

      // Populate room filter dropdown
      updateRoomFilter();
      // Render the chat log
      renderChatLog();
    },
    err => console.error("Messages listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

/** Sync room filter dropdown with rooms found in message data */
function updateRoomFilter() {
  const rooms = [...new Set(STATE.allMessages.map(m => m.room).filter(Boolean))];
  const sel   = $("chatRoomFilter");
  if (!sel) return;

  const current = sel.value;
  // Rebuild options
  sel.innerHTML = `<option value="">All Rooms</option>` +
    rooms.map(r => `<option value="${escHtml(r)}" ${r === current ? "selected" : ""}>${escHtml(r)}</option>`).join("");
}

/**
 * Render the chat log with optional search and room filter.
 * Highlights search terms in message text.
 */
function renderChatLog() {
  const searchTerm = ($("chatSearch")?.value || "").toLowerCase();
  const roomFilter = $("chatRoomFilter")?.value || "";

  let msgs = STATE.allMessages;

  if (roomFilter) msgs = msgs.filter(m => m.room === roomFilter);
  if (searchTerm) msgs = msgs.filter(m =>
    (m.text || "").toLowerCase().includes(searchTerm) ||
    (m.from || m.sender || "").toLowerCase().includes(searchTerm)
  );

  const container = $("chatLogs");
  if (!container) return;

  if (!msgs.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-text">No messages match the filter</div>
    </div>`;
    return;
  }

  container.innerHTML = msgs.map(m => {
    const sender   = m.from || m.sender || "Unknown";
    const text     = escHtml(m.text || "");
    const hiText   = searchTerm
      ? text.replace(new RegExp(`(${escHtml(searchTerm)})`, "gi"), "<mark>$1</mark>")
      : text;
    const room     = m.room || "global";
    const initials = sender.charAt(0).toUpperCase();

    return `
      <div class="msg-bubble">
        <div class="msg-avatar">${initials}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="msg-sender">${escHtml(sender)}</span>
            <span class="msg-room">#${escHtml(room)}</span>
            <span class="msg-time">${formatTimestamp(m.timestamp)}</span>
          </div>
          <div class="msg-text">${hiText}</div>
        </div>
      </div>
    `;
  }).join("");
}

/** Filter messages when search input / room dropdown changes */
window.filterMessages   = () => renderChatLog();

/** Scroll the chat container to the latest message */
window.scrollChatBottom = () => {
  const el = $("chatLogs");
  if (el) el.scrollTop = el.scrollHeight;
};

// ============================================================
//  LIVE ROOMS LISTENER
// ============================================================

/**
 * Real-time listener on "rooms" collection.
 * Updates the "Active Rooms" stat card.
 */
function listenRooms() {
  const unsub = onSnapshot(
    collection(db, COLL.ROOMS),
    snap => {
      const active = snap.docs.filter(d => (d.data().memberCount || 0) > 0).length;
      animateStat($("activeRooms"), active || snap.size);
    },
    err => console.error("Rooms listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

// ============================================================
//  ANNOUNCEMENTS
// ============================================================

/**
 * Real-time listener on "announcements" — renders history list.
 */
function listenAnnouncements() {
  const unsub = onSnapshot(
    query(collection(db, COLL.ANNOUNCEMENTS), orderBy("time", "desc"), limit(30)),
    snap => renderAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error("Announcements listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

function renderAnnouncements(list) {
  const container = $("announceList");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📢</div>
      <div class="empty-state-text">No announcements sent yet</div>
    </div>`;
    return;
  }

  container.innerHTML = list.map(a => `
    <div class="announce-item">
      <span class="announce-priority p-${a.priority || "medium"}">${a.priority || "medium"}</span>
      <div style="flex:1;">
        <div class="announce-text">${escHtml(a.text || "")}</div>
        <div class="announce-meta">${formatTimestamp(a.time)} · ${escHtml(a.target || "all")}</div>
      </div>
      <button class="announce-delete" onclick="deleteAnnouncement('${a.id}')" title="Delete">✕</button>
    </div>
  `).join("");
}

/**
 * Send a new announcement to Firestore.
 * The PWA listens on this collection and shows the message instantly.
 */
window.sendAnnouncement = async () => {
  const text     = ($("announceText")?.value    || "").trim();
  const priority = $("announcePriority")?.value || "medium";
  const target   = $("announceTarget")?.value   || "all";
  const imageUrl = ($("announceImageUrl")?.value || "").trim();
  const btn      = $("announceBtn");

  if (!text) { toast("Please write an announcement first.", "warning"); return; }

  btn.disabled   = true;
  btn.innerHTML  = `<span class="spinner"></span> Sending…`;

  try {
    await addDoc(collection(db, COLL.ANNOUNCEMENTS), {
      text,
      imageUrl:  imageUrl || null,
      priority,
      target,
      active:    true,
      time:      Date.now(),
      createdAt: serverTimestamp()
    });

    toast("Announcement sent successfully! ✅", "success");
    $("announceText").value = "";
    if ($("announceImageUrl")) $("announceImageUrl").value = "";
  } catch (err) {
    console.error("Announcement error:", err);
    toast("Failed to send announcement: " + err.message, "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "📢 Send Announcement";
  }
};

/** Delete an announcement document */
window.deleteAnnouncement = async id => {
  const yes = await confirmModal("Delete Announcement", "Remove this announcement from all user feeds?");
  if (!yes) return;
  try {
    await deleteDoc(doc(db, COLL.ANNOUNCEMENTS, id));
    toast("Announcement deleted.", "info");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
};

/** Preview modal for announcements */
window.previewAnnouncement = () => {
  const text = ($("announceText")?.value || "").trim();
  if (!text) { toast("Write an announcement first.", "warning"); return; }

  $("confirmTitle").textContent = "📢 Preview — How users will see it";
  $("confirmBody").innerHTML    = `<div style="background:rgba(0,224,255,.07);border:1px solid rgba(0,224,255,.2);
    border-radius:10px;padding:16px;color:var(--text-primary);line-height:1.6;">${escHtml(text)}</div>`;
  $("confirmOkBtn").style.display = "none";
  $("confirmModal").classList.add("open");
  $("confirmOkBtn").onclick = closeModal;
  setTimeout(() => {
    $("confirmOkBtn").style.display = "";
    $("confirmOkBtn").textContent = "Close";
    $("confirmOkBtn").className = "btn btn-outline";
    $("confirmOkBtn").onclick = closeModal;
  }, 0);
};

// ============================================================
//  PROMOTIONS
// ============================================================

/** Select a promo type card */
window.selectPromoType = (type, el) => {
  document.querySelectorAll(".promo-type-card").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  $("promoType").value = type;
  STATE.promoType      = type;
  // Show banner image field only for banner type
  const imgGroup = $("promoBannerImgGroup");
  if (imgGroup) imgGroup.style.display = type === "banner" ? "block" : "none";
};

/**
 * Send a promotion document to Firestore.
 * The PWA reads this and displays the appropriate popup / banner / modal.
 */
window.sendPromotion = async () => {
  const title    = ($("promoTitle")?.value    || "").trim();
  const body     = ($("promoBody")?.value     || "").trim();
  const cta      = ($("promoCTA")?.value      || "").trim();
  const type     = $("promoType")?.value      || "popup";
  const bgColor  = $("promoBgColor")?.value   || "#0d0f18";
  const duration = parseInt($("promoDuration")?.value || "8", 10);
  const imageUrl = ($("promoBannerImageUrl")?.value || "").trim();
  const url      = ($("promoUrl")?.value          || "").trim();
  const btn      = $("promoBtn");

  if (!title && !body) { toast("Please fill in title or message.", "warning"); return; }

  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner"></span> Sending…`;

  try {
    await addDoc(collection(db, COLL.PROMOTIONS), {
      type,
      title,
      body,
      cta:       cta || "Got it",
      url:       url || null,
      bgColor,
      duration,
      imageUrl:  imageUrl || null,
      active:    true,
      time:      Date.now(),
      createdAt: serverTimestamp()
    });

    toast(`${type.charAt(0).toUpperCase() + type.slice(1)} sent to all users! 🎯`, "success");
    $("promoTitle").value = "";
    $("promoBody").value  = "";
    $("promoCTA").value   = "";
    if ($("promoUrl")) $("promoUrl").value = "";
  } catch (err) {
    console.error("Promotion error:", err);
    toast("Failed to send promotion: " + err.message, "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "🎯 Send Promotion";
  }
};

// ============================================================
//  APP UPDATES
// ============================================================

/**
 * Push an update event to Firestore.
 * The PWA listens on "appUpdates/latest" and shows an update popup.
 *
 * PWA must listen:
 *   onSnapshot(doc(db,"appUpdates","latest"), snap => { ... })
 */
window.pushUpdate = async () => {
  const version   = ($("updateVersion")?.value   || "").trim();
  const type      = $("updateType")?.value       || "optional";
  const changelog = ($("updateChangelog")?.value || "").trim();
  const url       = ($("updateUrl")?.value       || "").trim();
  const btn       = $("updateBtn");

  if (!version) { toast("Please enter a version tag (e.g. v1.2.0).", "warning"); return; }

  const yes = await confirmModal(
    "Push Update",
    `Send "${version}" update to ALL users? ${type === "forced" ? "⚠️ This is a FORCED update — users cannot dismiss it." : ""}`
  );
  if (!yes) return;

  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner"></span> Pushing…`;

  try {
    await setDoc(doc(db, COLL.UPDATES, "latest"), {
      version,
      type,
      changelog,
      url:       url || null,
      active:    true,
      time:      Date.now(),
      pushedAt:  serverTimestamp()
    });

    await addDoc(collection(db, COLL.UPDATES), {
      version, type, changelog, url: url || null,
      time: Date.now(), pushedAt: serverTimestamp()
    });

    $("currentVersion").textContent = `Current version: ${version}`;
    toast(`Update ${version} pushed to all users! 🚀`, "success");
    $("updateVersion").value   = "";
    $("updateChangelog").value = "";
  } catch (err) {
    console.error("Update push error:", err);
    toast("Failed to push update: " + err.message, "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "🔄 Push Update to All Users";
  }
};

/**
 * Clear the active update flag so the popup stops showing.
 */
window.clearUpdateFlag = async () => {
  const yes = await confirmModal("Clear Update Flag", "Remove the active update banner from all user devices?");
  if (!yes) return;
  try {
    await setDoc(doc(db, COLL.UPDATES, "latest"), { active: false, clearedAt: serverTimestamp() }, { merge: true });
    toast("Update flag cleared.", "info");
  } catch (err) {
    toast("Failed to clear flag: " + err.message, "error");
  }
};

// ============================================================
//  PUSH NOTIFICATIONS (Firestore Queue)
// ============================================================

/**
 * Toggle the username field based on notification target type.
 */
window.toggleUserField = () => {
  const target    = $("notifyTarget")?.value;
  const userGroup = $("userTargetGroup");
  if (userGroup) userGroup.style.display = target === "user" ? "flex" : "none";
};

/**
 * Real-time listener on notifications — renders history.
 */
function listenNotifications() {
  const unsub = onSnapshot(
    query(collection(db, COLL.NOTIFICATIONS), orderBy("time", "desc"), limit(30)),
    snap => renderNotificationHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error("Notifications listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

function renderNotificationHistory(list) {
  const container = $("notifyHistory");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🔔</div>
      <div class="empty-state-text">No notifications sent yet</div>
    </div>`;
    return;
  }

  container.innerHTML = list.map(n => `
<div class="notif-item">

<span class="notif-target ${n.target === "all" ? "all" : ""}">
 ${n.target === "all" ? "📣 All" : `👤 ${escHtml(n.user || n.target)}`}
</span>

<div style="flex:1;">
 <div style="font-weight:600;font-size:13px;">
  ${escHtml(n.icon || "🔔")} ${escHtml(n.title)}
 </div>

 <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">
  ${escHtml(n.body)}
 </div>

 <div class="announce-meta">
  ${formatTimestamp(n.time)}
 </div>
</div>

<button class="announce-delete"
 onclick="deleteNotification('${n.id}')">
✕
</button>

</div>
`).join("");
}

window.deleteNotification = async id => {

 const yes = await confirmModal(
  "Delete Notification",
  "Remove this notification permanently?"
 );

 if(!yes) return;

 try{

  await deleteDoc(doc(db,"notifications",id));

  toast("Notification deleted","info");

 }catch(err){

  toast("Delete failed: "+err.message,"error");

 }

};

/**
 * Add a notification document to the Firestore queue.
 * The PWA listens on this collection and shows the notification.
 */
window.sendNotification = async () => {
  const target = $("notifyTarget")?.value || "all";
  const user   = ($("notifyUser")?.value   || "").trim();
  const title  = ($("notifyTitle")?.value  || "").trim();
  const body   = ($("notifyText")?.value   || "").trim();
  const icon   = ($("notifyIcon")?.value   || "🔔").trim();
  const btn    = $("notifyBtn");

  if (!title || !body)                { toast("Please fill in title and message.", "warning"); return; }
  if (target === "user" && !user)     { toast("Please enter a target username or UID.", "warning"); return; }

  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner"></span> Sending…`;

  try {
    await addDoc(collection(db, COLL.NOTIFICATIONS), {
      target: target === "all" ? "all" : user,
      user:   target === "user" ? user : null,
      title,
      body,
      icon,
      read:      false,
      time:      Date.now(),
      sentAt:    serverTimestamp()
    });

    toast(target === "all"
      ? `Broadcast notification sent! 📣`
      : `Notification sent to ${user}! 🔔`, "success");

    // Clear fields
    $("notifyTitle").value = "";
    $("notifyText").value  = "";
    $("notifyIcon").value  = "";
    $("notifyUser").value  = "";
  } catch (err) {
    console.error("Notification send error:", err);
    toast("Failed to send notification: " + err.message, "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = "🔔 Send Notification";
  }
};

// ============================================================
//  UTILITY FUNCTIONS
// ============================================================

/**
 * Generate an HTML status badge based on the user's status string.
 */
function statusBadge(status) {
  const s = (status || "offline").toLowerCase();
  if (s.includes("focus"))  return `<span class="status-badge focusing">Focusing</span>`;
  if (s === "online")       return `<span class="status-badge online">Online</span>`;
  return `<span class="status-badge offline">Offline</span>`;
}

/**
 * Format a focus time value (stored as minutes in Firestore) to a readable string.
 */
function formatFocusTime(minutes) {
  if (!minutes) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Format a Firestore Timestamp, Date, or Unix ms number to a readable string.
 */
function formatTimestamp(ts) {
  if (!ts) return "—";
  let date;
  if (ts?.toDate) date = ts.toDate();
  else if (typeof ts === "number") date = new Date(ts);
  else if (ts instanceof Date) date = ts;
  else return "—";

  const now   = new Date();
  const diff  = (now - date) / 1000; // seconds ago

  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Escape HTML special characters to prevent XSS in dynamic innerHTML.
 */
function escHtml(str) {
  if (typeof str !== "string") return str ?? "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
//  PWA INTEGRATION — code to paste in your PWA's main JS
// ============================================================
/*
  ─────────────────────────────────────────────────────────────
  PASTE THIS CODE IN YOUR PWA's main app JavaScript file.
  It handles live reading of admin broadcasts.
  ─────────────────────────────────────────────────────────────

  import { db, collection, doc, onSnapshot, query, where, orderBy, limit, updateDoc } from "./firebase.js";

  // ── 1. Announcement listener (shows banner at top of PWA)
  let lastAnnouncementId = null;
  onSnapshot(
    query(collection(db, "announcements"),
          where("active","==",true),
          orderBy("time","desc"),
          limit(1)),
    snap => {
      if (snap.empty) return;
      const a = snap.docs[0];
      if (a.id === lastAnnouncementId) return; // already shown
      lastAnnouncementId = a.id;
      showAnnouncementBanner(a.data());
    }
  );

  // ── 2. App Update listener (shows update popup)
  onSnapshot(doc(db, "appUpdates", "latest"), snap => {
    if (!snap.exists() || !snap.data().active) return;
    const u = snap.data();
    showUpdatePopup(u);
  });

  // ── 3. Promotion listener (popup / banner / modal)
  let lastPromoId = null;
  onSnapshot(
    query(collection(db, "promotions"),
          where("active","==",true),
          orderBy("time","desc"),
          limit(1)),
    snap => {
      if (snap.empty) return;
      const p = snap.docs[0];
      if (p.id === lastPromoId) return;
      lastPromoId = p.id;
      showPromotion(p.data());
    }
  );

  // ── 4. Personal notification listener (for logged-in user)
  const currentUser = auth.currentUser;
  if (currentUser) {
    onSnapshot(
      query(collection(db, "notifications"),
            where("target","in",["all", currentUser.displayName || currentUser.uid]),
            where("read","==",false),
            orderBy("time","desc"),
            limit(10)),
      snap => {
        snap.docs.forEach(d => {
          showInAppNotification(d.data());
          updateDoc(d.ref, { read: true }); // mark as read
        });
      }
    );
  }

  // ── Update Popup implementation example
  function showUpdatePopup(updateData) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);
      z-index:99999;display:flex;align-items:center;justify-content:center;`;
    overlay.innerHTML = `
      <div style="background:#111;border:1px solid rgba(0,224,255,.3);border-radius:16px;
                  padding:32px;max-width:360px;text-align:center;color:#eef0ff;">
        <div style="font-size:48px;margin-bottom:12px;">🚀</div>
        <h2 style="font-size:20px;margin-bottom:8px;">Update Available</h2>
        <p style="color:#888;font-size:13px;margin-bottom:8px;">${updateData.version || ""}</p>
        <pre style="text-align:left;font-size:11px;color:#aaa;background:#0a0a0f;
                    padding:12px;border-radius:8px;margin-bottom:20px;white-space:pre-wrap;">
${updateData.changelog || ""}</pre>
        <button id="updateNowBtn"
          style="background:linear-gradient(135deg,#00e0ff,#7c5cfc);border:none;
                 padding:12px 32px;border-radius:10px;color:#000;font-weight:700;
                 font-size:14px;cursor:pointer;width:100%;">
          Update App
        </button>
        ${updateData.type !== "forced"
          ? `<button onclick="this.closest('div[style]').remove()"
               style="background:none;border:none;color:#555;margin-top:12px;
                      cursor:pointer;font-size:12px;">Dismiss</button>`
          : ""}
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("updateNowBtn").onclick = async () => {
      document.getElementById("updateNowBtn").innerHTML =
        `<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.2);
                      border-top-color:#000;border-radius:50%;animation:spin .6s linear infinite;
                      margin-right:8px;vertical-align:middle;"></span>Updating…`;
      // Clear service worker cache if applicable
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      setTimeout(() => location.reload(true), 1500);
    };
  }
*/

// ============================================================
//  PROMOTIONS HISTORY
// ============================================================

function listenPromotions() {
  const unsub = onSnapshot(
    query(collection(db, COLL.PROMOTIONS), orderBy("time", "desc"), limit(30)),
    snap => renderPromotionHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error("Promotions listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

function renderPromotionHistory(list) {
  const container = $("promoHistory");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🎯</div>
      <div class="empty-state-text">No promotions sent yet</div>
    </div>`;
    return;
  }

  container.innerHTML = list.map(p => `
    <div class="announce-item">
      <span class="announce-priority p-medium" style="text-transform:capitalize;">${escHtml(p.type || "popup")}</span>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${escHtml(p.title || "—")}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(p.body || "")}</div>
        ${p.url ? `<div style="font-size:11px;color:var(--accent-cyan);margin-top:2px;">🔗 ${escHtml(p.url)}</div>` : ""}
        <div class="announce-meta">${formatTimestamp(p.time)} · ${p.active ? "Active" : "Inactive"}</div>
      </div>
      <button class="announce-delete" onclick="deletePromotion('${p.id}')" title="Delete">✕</button>
    </div>
  `).join("");
}

window.deletePromotion = async id => {
  const yes = await confirmModal("Delete Promotion", "Remove this promotion permanently?");
  if (!yes) return;
  try {
    await deleteDoc(doc(db, COLL.PROMOTIONS, id));
    toast("Promotion deleted.", "info");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
};

// ============================================================
//  APP UPDATES HISTORY
// ============================================================

function listenAppUpdates() {
  const unsub = onSnapshot(
    query(collection(db, COLL.UPDATES), orderBy("time", "desc"), limit(20)),
    snap => renderUpdateHistory(snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.id !== "latest")
    ),
    err => console.error("Updates listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

function renderUpdateHistory(list) {
  const container = $("updateHistory");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🔄</div>
      <div class="empty-state-text">No updates pushed yet</div>
    </div>`;
    return;
  }

  container.innerHTML = list.map(u => `
    <div class="announce-item">
      <span class="announce-priority p-${u.type === "forced" ? "high" : "low"}">${escHtml(u.type || "optional")}</span>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${escHtml(u.version || "—")}</div>
        ${u.changelog ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escHtml(u.changelog)}</div>` : ""}
        ${u.url ? `<div style="font-size:11px;color:var(--accent-cyan);margin-top:2px;">🔗 ${escHtml(u.url)}</div>` : ""}
        <div class="announce-meta">${formatTimestamp(u.time)}</div>
      </div>
      <button class="announce-delete" onclick="deleteUpdate('${u.id}')" title="Delete">✕</button>
    </div>
  `).join("");
}

window.deleteUpdate = async id => {
  const yes = await confirmModal("Delete Update Record", "Remove this update from history?");
  if (!yes) return;
  try {
    await deleteDoc(doc(db, COLL.UPDATES, id));
    toast("Update record deleted.", "info");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
};

// ============================================================
//  ROOMS — live focusing users
// ============================================================

function listenRoomsAdmin() {
  const unsub = onSnapshot(
    collection(db, COLL.USERS),
    snap => {
      const focusing = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.isFocusing === true || (u.status && u.status.toLowerCase().includes("focus")));
      renderRoomsAdmin(focusing);
    },
    err => console.error("Rooms admin listener error:", err)
  );
  STATE.unsubscribers.push(unsub);
}

function renderRoomsAdmin(users) {
  const container = $("roomsContainer");
  if (!container) return;

  if (!users.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🏠</div>
      <div class="empty-state-text">No users currently focusing</div>
    </div>`;
    return;
  }

  // Group by room
  const byRoom = {};
  users.forEach(u => {
    const room = u.room || "default";
    if (!byRoom[room]) byRoom[room] = [];
    byRoom[room].push(u);
  });

  container.innerHTML = Object.entries(byRoom).map(([room, roomUsers]) => `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;">
      <div style="font-weight:700;font-size:16px;margin-bottom:14px;color:var(--accent-cyan);">
        🏠 Room: ${escHtml(room)}
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">${roomUsers.length} focusing</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${roomUsers.map(u => `
          <div style="
            background:var(--bg-input);border:1px solid rgba(0,229,160,0.25);
            border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px;
          ">
            <div style="
              width:32px;height:32px;border-radius:50%;
              background:linear-gradient(135deg,var(--accent-green),var(--accent-cyan));
              display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:13px;color:#000;
            ">${(u.name || "?")[0].toUpperCase()}</div>
            <div>
              <div style="font-size:13px;font-weight:600;">${escHtml(u.name || u.id)}</div>
              <div style="font-size:11px;color:var(--accent-green);">⏱️ ${formatFocusTime(u.focusTime || 0)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

// ============================================================
//  LEADERBOARD
// ============================================================

function listenLeaderboard() {
  // Uses STATE.allUsers which is already populated by listenUsers()
  // renderLeaderboardSection is called from listenUsers snapshot
}

function renderLeaderboardSection() {
  const container = $("leaderboardContainer");
  if (!container) return;

  const users = [...STATE.allUsers]
    .sort((a, b) => (b.xp || b.focusTime || 0) - (a.xp || a.focusTime || 0))
    .slice(0, 20);

  if (!users.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🏆</div>
      <div class="empty-state-text">No users yet</div>
    </div>`;
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">Rank</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">User</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">XP</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">Level</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">Focus Time</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--text-muted);font-weight:600;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${users.map((u, i) => {
          const xp    = u.xp || u.focusTime || 0;
          const level = u.level || Math.floor(xp / 100) + 1;
          const rank  = medals[i] || `#${i + 1}`;
          return `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:12px;font-size:16px;">${rank}</td>
            <td style="padding:12px;">
              <div class="user-cell">
                <div class="user-avatar-sm">${(u.name || "?")[0].toUpperCase()}</div>
                <div>
                  <div style="font-weight:600;font-size:13px;">${escHtml(u.name || "—")}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${escHtml(u.email || "")}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px;font-family:var(--font-mono);color:var(--accent-amber);">⭐ ${xp}</td>
            <td style="padding:12px;">
              <span style="background:rgba(124,92,252,0.15);color:var(--accent-violet);
                border:1px solid rgba(124,92,252,0.3);border-radius:20px;
                padding:2px 10px;font-size:12px;font-weight:600;">
                Lv.${level}
              </span>
            </td>
            <td style="padding:12px;font-family:var(--font-mono);font-size:12px;">${formatFocusTime(u.focusTime || 0)}</td>
            <td style="padding:12px;">${statusBadge(u.status)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

// ============================================================
//  END OF admin.js
// ============================================================
