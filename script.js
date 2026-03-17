/**
 * script.js — Untitled World Focus Timer (UPGRADED v2)
 *
 * All original bug fixes preserved (FIX-A through FIX-H).
 *
 * NEW features added:
 *   NEW-1: window._setTimerMode — bridges HTML preset buttons to module-scoped mode
 *   NEW-2: initRoomUI() — show/hide room controls & session box based on roomId
 *   NEW-3: window.exitRoom() / window.exitToGlobal() — leave room back to global
 *   NEW-4: window.openPanel() — open social sheet (exposed for inline HTML onclick)
 *   NEW-5: global focus display — shows focusing users in #globalBox
 *   NEW-6: enhanced member cards with avatar, focus time, status dot
 *   NEW-7: enhanced leaderboard entries with medal styling
 *   NEW-8: join-error uses inline div instead of alert()
 *   NEW-9: room badge shows actual room name after create/join
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS — all from firebase.js (FIX-A: no duplicate initializeApp)
// ─────────────────────────────────────────────────────────────────────────────

import {
  db, auth, messaging, getToken, onMessage
} from "./firebase.js";

import {
  collection, addDoc, onSnapshot,
  doc, setDoc, updateDoc, increment, deleteDoc,
  query, orderBy, getDocs, getDoc, where, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const VAPID_KEY = "BDTkDBt3daAUhVvkAHvKuEJn1DI6MwZh5nYzMFu8ym7UQGKNaAbzCtH-RE6DiHCv3k22w_mfl7u8jY-KqN5aNpc";

// FCM Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then(reg => console.log("[SW] FCM worker ready:", reg.scope))
    .catch(err => console.warn("[SW] FCM error:", err));
}

// Room from URL query param
const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "default";

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentUser    = "";
  let timerInterval;
  let seconds        = 0;
  let isRunning      = false;
  let mode           = "stopwatch";
  let initialSeconds = 0;
  let savedMinutes   = 0;
  let chattingWith   = "";
  let lastWaveTime   = 0;
  let lastMsgTime    = Date.now();
  let listenersAttached = false;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function qs(id) { return document.getElementById(id); }

  function updateDisplay() {
    const d = qs("display");
    if (!d) return;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    d.innerText = `${mins < 10 ? "0"+mins : mins}:${secs < 10 ? "0"+secs : secs}`;
  }

  function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  function getWeekNumber() {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return `${d.getFullYear()}-W${Math.ceil((((d - yearStart) / 86400000) + 1) / 7)}`;
  }

  function showToast(msg) {
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ── NEW-1: Expose timer mode setter for HTML preset buttons ────────────────
  window._setTimerMode = (m, initSecs) => {
    mode = m;
    if (m === "countdown") {
      initialSeconds = initSecs;
      seconds = initSecs;
    } else {
      initialSeconds = 0;
      seconds = 0;
    }
    if (!isRunning) updateDisplay();
  };

  // ── DOM References ─────────────────────────────────────────────────────────
  const loginOverlay  = qs("loginOverlay");   // FIX-B: may be null on timer.html
  const display       = qs("display");
  const ring          = qs("ring");
  const modeLabel     = qs("modeLabel");
  const startBtn      = qs("startBtn");       // FIX-C: null-guarded below
  const stopBtn       = qs("stopBtn");        // FIX-D: null-guarded below
  const menuToggle    = qs("menuToggle");
  const navMenu       = qs("navMenu");
  const openPanelBtn  = qs("openPanelBtn");
  const closePanelBtn = qs("closePanelBtn");
  const socialSheet   = qs("socialSheet");
  const backdrop      = qs("backdrop");
  const userList      = qs("userList");
  const statusCard    = qs("statusCard");

  // ── NEW-2: Room UI refs ────────────────────────────────────────────────────
  const joinCreateRow = qs("joinCreateRow");
  const inRoomRow     = qs("inRoomRow");
  const roomBadge     = qs("roomBadge");
  const exitRoomBtn   = qs("exitRoomBtn");
  const exitSessionBtn= qs("exitSessionBtn");
  const globalBox     = qs("globalBox");

  // ── Load persisted username ────────────────────────────────────────────────
  const savedName = localStorage.getItem("userName");
  if (savedName) {
    currentUser = savedName;
    if (loginOverlay) loginOverlay.style.display = "none"; // FIX-B
  }

  // ── StatusCard → leaderboard ───────────────────────────────────────────────
  if (statusCard) {
    statusCard.addEventListener("click", () => {
      window.location.href = "leaderboard.html";
    });
  }

  // ── NEW-2: Set initial room UI state ───────────────────────────────────────
  function initRoomUI() {
    const inRoom = roomId !== "default";

    // Room control rows
    if (joinCreateRow) joinCreateRow.style.display = inRoom ? "none" : "flex";
    if (inRoomRow)     inRoomRow.style.display     = inRoom ? "flex" : "none";

    // Session box: global vs room
    if (globalBox)      globalBox.style.display     = inRoom ? "none" : "block";
    if (openPanelBtn)   openPanelBtn.style.display  = inRoom ? "block" : "none";

    // Room badge label
    if (roomBadge && inRoom) {
      const label = roomId.replace(/_[a-z0-9]{3}$/i, ""); // strip random suffix
      roomBadge.textContent = "📚 " + label;
    }
  }
  initRoomUI();

  // ── NEW-3: Exit Room / Exit Session ───────────────────────────────────────
  window.exitRoom = async () => {
    if (!currentUser) { window.location.href = "/timer"; return; }
    try {
      await updateDoc(doc(db, "users", currentUser), { room: "default" });
    } catch {}
    window.location.href = window.location.pathname; // removes ?room=...
  };
  window.exitToGlobal = window.exitRoom;

  if (exitRoomBtn)    exitRoomBtn.addEventListener("click",    window.exitRoom);
  if (exitSessionBtn) exitSessionBtn.addEventListener("click", window.exitRoom);

  // ── NEW-4: openPanel exposed for room box onclick ──────────────────────────
  window.openPanel = () => {
    if (socialSheet) socialSheet.classList.add("open");
    if (backdrop)    backdrop.style.display = "block";
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Firebase Auth
  // ─────────────────────────────────────────────────────────────────────────

  onAuthStateChanged(auth, async user => {

    if (!user) {
      if (loginOverlay) loginOverlay.style.display = "flex"; // FIX-B
      return;
    }

    currentUser = user.displayName || user.email || "";
    localStorage.setItem("userName", currentUser);
    if (loginOverlay) loginOverlay.style.display = "none"; // FIX-B

    const today       = getTodayDate();
    const currentWeek = getWeekNumber();
    const userRef     = doc(db, "users", currentUser);
    const snap        = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      if (data.lastActiveDate !== today) {
        await updateDoc(userRef, { focusTime: 0, lastActiveDate: today });
      }
    }

    await setDoc(userRef, {
      name:           currentUser,
      email:          user.email,
      status:         "Online",
      room:           roomId,
      lastActiveDate: today,
      lastActiveWeek: currentWeek
    }, { merge: true });

    // FIX-H: FCM token after auth
    if (Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
    if (Notification.permission === "granted") {
      try {
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (token) {
          await updateDoc(doc(db, "users", currentUser), { fcmToken: token });
        }
      } catch (err) {
        console.warn("[FCM] getToken error:", err);
      }
    }

    if (!listenersAttached) {
      listenersAttached = true;
      attachListeners();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Room Create / Join
  // ─────────────────────────────────────────────────────────────────────────

  const createModal   = qs("createModal");
  const createRoomBtn = qs("createRoomBtn");
  const confirmCreate = qs("confirmCreate");

  if (createRoomBtn && createModal) {
    createRoomBtn.onclick = () => { createModal.style.display = "flex"; };
  }

  if (confirmCreate) {
    confirmCreate.onclick = async () => {
      const name = (qs("roomName")?.value || "").trim();
      if (!name) { alert("Enter room name"); return; }
      const newRoomId = name + "_" + Math.random().toString(36).substring(2, 5);
      await setDoc(doc(db, "rooms", newRoomId), {
        name, createdBy: currentUser, createdAt: Date.now()
      });
      await updateDoc(doc(db, "users", currentUser), { room: newRoomId });
      location.href = location.pathname + "?room=" + newRoomId;
    };
  }

  const joinModal   = qs("joinModal");
  const joinRoomBtn = qs("joinRoomBtn");
  const confirmJoin = qs("confirmJoin");

  if (joinRoomBtn && joinModal) {
    joinRoomBtn.onclick = () => {
      const errEl = qs("joinError");
      if (errEl) errEl.style.display = "none";
      joinModal.style.display = "flex";
    };
  }

  if (confirmJoin) {
    confirmJoin.onclick = async () => {
      const id    = (qs("joinRoomInput")?.value || "").trim();
      const errEl = qs("joinError");
      if (!id) { alert("Enter Room ID"); return; }
      const snap = await getDoc(doc(db, "rooms", id));
      if (!snap.exists()) {
        // NEW-8: inline error instead of alert
        if (errEl) errEl.style.display = "block";
        return;
      }
      await updateDoc(doc(db, "users", currentUser), { room: id });
      location.href = location.pathname + "?room=" + id;
    };
  }

  // Close modals
  document.querySelectorAll(".closeModal").forEach(btn => {
    btn.addEventListener("click", () => {
      if (createModal) createModal.style.display = "none";
      if (joinModal)   joinModal.style.display   = "none";
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Timer Logic (ORIGINAL — DO NOT BREAK)
  // ─────────────────────────────────────────────────────────────────────────

  // FIX-C: null-guard
  if (startBtn) {
    startBtn.addEventListener("click", async () => {

      if (!currentUser) { alert("Login first"); return; }

      const currentWeek = getWeekNumber();
      const userRef     = doc(db, "users", currentUser);
      const snap        = await getDoc(userRef);

      if (snap.exists() && snap.data().lastActiveWeek !== currentWeek) {
        await updateDoc(userRef, {
          weeklyXP:       0,
          lastActiveWeek: currentWeek
        });
      }

      await updateDoc(doc(db, "users", currentUser), { status: "Focusing 👋" });

      if (!isRunning) {
        isRunning    = true;
        savedMinutes = 0;
        startBtn.style.display = "none";
        if (stopBtn) stopBtn.style.display  = "block";
        if (ring)    ring.classList.add("active");

        timerInterval = setInterval(async () => {
          if (mode === "countdown") {
            if (seconds > 0) { seconds--; updateDisplay(); }
            else { finishTimer(); }
          } else {
            seconds++;
            updateDisplay();
            if (seconds % 60 === 0 && isRunning) {
              savedMinutes++;
              await updateDoc(doc(db, "users", currentUser), {
                status: "Focusing 👋", focusTime: increment(1)
              });
            }
            if (seconds % 120 === 0 && isRunning) {
              await updateDoc(doc(db, "users", currentUser), {
                weeklyXP: increment(1)
              });
            }
          }
        }, 1000);
      }
    });
  }

  // FIX-D: null-guard
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      clearInterval(timerInterval);
      isRunning = false;

      const totalMins   = Math.floor(seconds / 60);
      const unsavedMins = totalMins - savedMinutes;
      if (unsavedMins > 0) {
        await updateDoc(doc(db, "users", currentUser), {
          status: "Online", focusTime: increment(unsavedMins)
        });
      } else {
        await updateDoc(doc(db, "users", currentUser), { status: "Online" });
      }
      savedMinutes = 0;

      if (startBtn) startBtn.style.display = "block";
      stopBtn.style.display = "none";
      if (ring) ring.classList.remove("active");

      if (mode === "countdown") {
        seconds = initialSeconds;
      } else {
        seconds = 0;
        if (display) display.innerText = "00:00";
      }
      updateDisplay();
    });
  }

  function finishTimer() {
    clearInterval(timerInterval);
    isRunning = false;
    const totalMins   = Math.floor((initialSeconds - seconds) / 60);
    const unsavedMins = totalMins - savedMinutes;
    if (unsavedMins > 0 && currentUser) {
      updateDoc(doc(db, "users", currentUser), {
        status: "Online", focusTime: increment(unsavedMins)
      }).catch(() => {});
    }
    savedMinutes = 0;
    if (startBtn) startBtn.style.display = "block";
    if (stopBtn)  stopBtn.style.display  = "none";
    if (ring)     ring.classList.remove("active");
    seconds = initialSeconds;
    updateDisplay();
    if (Notification.permission === "granted") {
      new Notification("Session Complete! 🎉", {
        body: "Great focus session!", icon: "/icon-192.png"
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Panel & Menu
  // ─────────────────────────────────────────────────────────────────────────

  function closePanel() {
    if (socialSheet) socialSheet.classList.remove("open");
    if (backdrop)    backdrop.style.display = "none";
  }

  if (openPanelBtn) openPanelBtn.addEventListener("click", () => {
    if (socialSheet) socialSheet.classList.add("open");
    if (backdrop)    backdrop.style.display = "block";
  });

  if (closePanelBtn) closePanelBtn.addEventListener("click", closePanel);
  if (backdrop)      backdrop.addEventListener("click", closePanel);

  if (menuToggle && navMenu) {
    menuToggle.addEventListener("click", () => navMenu.classList.toggle("active"));
    document.addEventListener("click", e => {
      if (!menuToggle.contains(e.target) && !navMenu.contains(e.target)) {
        navMenu.classList.remove("active");
      }
    });
  }

  // FIX-E: correct invite button IDs
  const inviteWhatsapp = qs("inviteWhatsapp");
  const copyInvite     = qs("copyInvite");
  const inviteLink     = `${location.origin}${location.pathname}?room=${roomId}`;
  const inviteMsg      = `📚 Focus Study Room\n\nLet's stay productive together 🚀\n\nJoin here:\n${inviteLink}`;

  if (inviteWhatsapp) {
    inviteWhatsapp.onclick = () => {
      window.open("https://wa.me/?text=" + encodeURIComponent(inviteMsg), "_blank");
    };
  }
  if (copyInvite) {
    copyInvite.onclick = async () => {
      try {
        await navigator.clipboard.writeText(inviteLink);
      } catch {
        /* fallback */
        const ta = document.createElement("textarea");
        ta.value = inviteLink;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      /* NEW: Toast instead of alert */
      const t = document.createElement("div");
      t.className = "toast-msg";
      t.textContent = "✅ Invite link copied!";
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Visibility / Unload
  // ─────────────────────────────────────────────────────────────────────────

  window.addEventListener("visibilitychange", async () => {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser), {
      status: document.visibilityState === "hidden" ? "Offline" : "Online"
    }).catch(() => {});
  });

  window.addEventListener("beforeunload", () => {
    if (currentUser) {
      navigator.sendBeacon; // just reference
      updateDoc(doc(db, "users", currentUser), { status: "Offline" }).catch(() => {});
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Logout
  // ─────────────────────────────────────────────────────────────────────────

  window.logoutUser = async () => {
    await signOut(auth);
    localStorage.removeItem("userName");
    location.reload();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FCM foreground messages
  // ─────────────────────────────────────────────────────────────────────────

  onMessage(messaging, payload => {
    const { title = "Notification", body = "" } = payload.notification || {};
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Window-exposed helpers (called from HTML onclick attributes)
  // ─────────────────────────────────────────────────────────────────────────

  window.wave = async name => {
    await updateDoc(doc(db, "users", name), {
      waveFrom: currentUser,
      waveTime: Date.now()
    });
  };

  window.openChat = name => {
    chattingWith = name;
    const box  = qs("chatBox");
    const area = qs("chatMessages");
    const lbl  = qs("chatWithLabel");
    if (box)  { box.style.display = "flex"; box.classList.add("open"); }
    if (area) area.innerHTML = `<div style="text-align:center;opacity:.5;font-size:12px;padding:16px">Loading chat...</div>`;
    if (lbl)  lbl.textContent = "💬 " + name;
  };

  window.closeChat = () => {
    const box = qs("chatBox");
    if (box) { box.style.display = "none"; box.classList.remove("open"); }
  };

  window.sendMsg = async () => {
    const input = qs("chatInput");
    const txt   = input?.value?.trim();
    if (!txt || !chattingWith) return;
    await addDoc(collection(db, "messages"), {
      from: currentUser, to: chattingWith,
      text: txt, room: roomId,
      time: Date.now(), status: "sent"
    });
    if (input) input.value = "";
  };

  // Chat input Enter key
  const chatInput = qs("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => {
      if (e.key === "Enter") window.sendMsg();
    });
    chatInput.addEventListener("input", async () => {
      if (!chattingWith) return;
      await setDoc(doc(db, "typing", currentUser + "_" + chattingWith), {
        from: currentUser, to: chattingWith, typing: true, time: Date.now()
      }).catch(() => {});
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRESTORE LISTENERS
  // FIX-F: merged into one onSnapshot for users
  // FIX-G: messages filtered & de-duped
  // NEW-5: global focus display
  // NEW-6: enhanced member cards
  // NEW-7: enhanced leaderboard entries
  // ═══════════════════════════════════════════════════════════════════════════

  function attachListeners() {

    // ── Users: members + leaderboard + wave + NEW global box ──────────────
    onSnapshot(collection(db, "users"), snapshot => {

      const allUsers = [];
      snapshot.forEach(d => allUsers.push({ id: d.id, ...d.data() }));

      // ── NEW-5: Global focus display ─────────────────────────────────────
      const globalUsersEl = qs("globalUsers");
      if (globalUsersEl && roomId === "default") {
        const focusing = allUsers
          .filter(u => u.status === "Focusing 👋")
          .sort((a, b) => (b.focusTime || 0) - (a.focusTime || 0))
          .slice(0, 6);

        if (focusing.length === 0) {
          globalUsersEl.innerHTML = `<div class="no-focus-msg">No one focusing right now — start a session! 🚀</div>`;
        } else {
          globalUsersEl.innerHTML = focusing.map(u => {
            const h = Math.floor((u.focusTime || 0) / 60);
            const m = (u.focusTime || 0) % 60;
            const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
            return `<div class="g-user-row">
              <div class="g-left">
                <span class="focus-dot"></span>
                <span>${u.name || "User"}</span>
              </div>
              <span class="g-time">${timeStr}</span>
            </div>`;
          }).join("");
        }
      }

      // ── Member list (room filtered) ─────────────────────────────────────
      if (userList) {
        const roomUsers = allUsers.filter(u => u.room === roomId &&
          (u.status === "Online" || u.status === "Focusing 👋" || u.status === "Offline"));

        if (roomUsers.length === 0) {
          userList.innerHTML = `<div style="text-align:center;opacity:.4;font-size:13px;padding:20px">
            No members yet · Share the invite link 🔗</div>`;
        } else {
          userList.innerHTML = "";
          roomUsers.forEach(u => {
            const isMe   = u.name === currentUser;
            const dotCls = u.status === "Focusing 👋" ? "s-focus" :
                           u.status === "Online"      ? "s-online" : "s-offline";
            const initial = (u.name || "?")[0].toUpperCase();
            const h = Math.floor((u.focusTime || 0) / 60);
            const m = (u.focusTime || 0) % 60;
            const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

            const card = document.createElement("div");
            card.className = "member-card";
            card.innerHTML = `
              <div class="member-av">${initial}</div>
              <div class="member-info">
                <div class="member-name">${u.name || "User"}${isMe ? ' <span style="color:var(--blue);font-size:10px;">(You)</span>' : ""}</div>
                <div class="member-stat">
                  <span class="sdot ${dotCls}"></span>
                  <span>${u.status}</span>
                  <span style="margin-left:4px;color:var(--blue);">· ${timeStr}</span>
                </div>
              </div>
              ${!isMe ? `
              <div class="member-acts">
                <button class="mact wave" onclick="wave('${u.name}')">👋</button>
                <button class="mact chat" onclick="openChat('${u.name}')">💬</button>
              </div>` : ""}`;
            userList.appendChild(card);
          });
        }
      }

      // ── NEW-7: Room Leaderboard (enhanced) ─────────────────────────────
      const board = qs("leaderboard");
      if (board) {
        const sorted = allUsers
          .sort((a, b) => (b.focusTime || 0) - (a.focusTime || 0))
          .slice(0, 10);

        board.innerHTML = "";
        sorted.forEach((u, i) => {
          const h = Math.floor((u.focusTime || 0) / 60);
          const m = (u.focusTime || 0) % 60;
          const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
          const isMe  = u.name === currentUser;
          const el = document.createElement("div");
          el.style.cssText = isMe ? "border-color:rgba(0,242,254,.3);" : "";
          el.innerHTML = `<span>${medal} ${u.name || "User"}${isMe ? " (You)" : ""}</span><span>${timeStr}</span>`;
          board.appendChild(el);
        });
      }

      // ── Wave detection ──────────────────────────────────────────────────
      allUsers.forEach(u => {
        if (u.waveFrom && u.name === currentUser && u.waveTime > lastWaveTime) {
          lastWaveTime = u.waveTime;
          const container = qs("wavePopupContainer") || document.body;
          const pop = document.createElement("div");
          pop.className = "wave-popup";
          pop.textContent = `👋 ${u.waveFrom} waved at you!`;
          container.appendChild(pop);
          setTimeout(() => {
            pop.remove();
            updateDoc(doc(db, "users", currentUser), { waveFrom: "", waveTime: 0 }).catch(() => {});
          }, 3500);
        }
      });
    });

    // ── Chat messages (room + conversation filtered) ─────────────────────
    // FIX-G: filtered query, not full collection scan
    onSnapshot(
      query(collection(db, "messages"), where("room", "==", roomId), orderBy("time")),
      snap => {
        const chatArea = qs("chatMessages");
        if (!chatArea) return;
        chatArea.innerHTML = "";
        snap.forEach(d => {
          const msg = d.data();
          const isConvo =
            (msg.from === currentUser && msg.to === chattingWith) ||
            (msg.from === chattingWith && msg.to === currentUser);
          if (!isConvo) return;

          const seen = msg.status === "seen";
          const del  = msg.status === "delivered";
          const tick = seen ? '<span style="color:var(--blue);font-size:10px;margin-left:5px;">✔✔</span>'
                     : del  ? '<span style="opacity:.5;font-size:10px;margin-left:5px;">✔✔</span>'
                             : '<span style="opacity:.4;font-size:10px;margin-left:5px;">✔</span>';

          const bubble = document.createElement("div");
          bubble.className = msg.from === currentUser ? "msg-me" : "msg-other";
          bubble.style.cssText = "max-width:75%;padding:9px 13px;margin:5px;border-radius:16px;font-size:13px;line-height:1.4;word-break:break-word;";
          if (msg.from === currentUser) {
            bubble.style.cssText += "background:rgba(0,242,254,.22);color:#fff;margin-left:auto;display:block;border-radius:16px 16px 3px 16px;";
            bubble.innerHTML = `${msg.text}${tick}`;
          } else {
            bubble.style.cssText += "background:rgba(255,255,255,.08);border-radius:16px 16px 16px 3px;";
            bubble.innerHTML = `<span style="font-size:11px;opacity:.6">${msg.from}</span><br>${msg.text}`;
          }
          chatArea.appendChild(bubble);

          if (msg.to === currentUser && msg.status === "sent") {
            updateDoc(doc(db, "messages", d.id), { status: "delivered" }).catch(() => {});
          }
          if (msg.to === currentUser && msg.from === chattingWith) {
            updateDoc(doc(db, "messages", d.id), { status: "seen" }).catch(() => {});
          }
        });
        // Auto-scroll
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    );

    // ── Message notifications (new incoming only) ────────────────────────
    // FIX-G: filtered to room + current user as recipient
    onSnapshot(
      query(
        collection(db, "messages"),
        where("room", "==", roomId),
        where("to",   "==", currentUser),
        orderBy("time")
      ),
      snap => {
        snap.forEach(d => {
          const msg = d.data();
          if (msg.from === currentUser || msg.time <= lastMsgTime) return;
          lastMsgTime = msg.time;

          const box = qs("chatNotify");
          const txt = qs("notifyText");
          if (!box || !txt) return;
          txt.textContent = `${msg.from}: ${msg.text}`;
          box.style.display = "block";
          setTimeout(() => { box.style.display = "none"; }, 4000);
        });
      }
    );

    // ── Typing indicator ────────────────────────────────────────────────
    onSnapshot(collection(db, "typing"), snap => {
      snap.forEach(d => {
        const t = d.data();
        if (t.to !== currentUser || t.from !== chattingWith) return;
        let el = qs("typingIndicator");
        if (!el) {
          el = document.createElement("div");
          el.id = "typingIndicator";
          el.style.cssText = "opacity:.6;font-size:11px;padding:4px 12px;color:var(--blue);";
          el.textContent = t.from + " typing...";
          qs("chatMessages")?.appendChild(el);
        }
        setTimeout(() => el?.remove(), 2000);
      });
    });

    // ── One-time stale message cleanup (FIX-G) ───────────────────────────
    getDocs(query(collection(db, "messages"), where("room", "==", roomId)))
      .then(snap => {
        snap.forEach(async d => {
          if (Date.now() - d.data().time > 172800000) {
            await deleteDoc(doc(db, "messages", d.id));
          }
        });
      }).catch(() => {});
  }

}); // end DOMContentLoaded
