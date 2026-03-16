/**
 * script.js — Untitled World Focus Timer (FIXED)
 *
 * Bugs fixed in this file:
 *
 *   FIX-A (line 45 original): Removed duplicate initializeApp() call.
 *          firebase.js already initialises the app with a getApps() guard.
 *          Calling initializeApp() again threw "duplicate-app" and killed
 *          the entire module — nothing below line 45 ever ran.
 *          Solution: import db, auth from ./firebase.js instead.
 *
 *   FIX-B (line 134 original): loginOverlay null crash on timer.html.
 *          timer.html has no #loginOverlay element. Accessing .style on null
 *          threw TypeError inside onAuthStateChanged. Added null-guards.
 *
 *   FIX-C (line 266 original): startBtn.addEventListener on null.
 *          index.html loads this script but has no #startBtn. Null-guard added.
 *
 *   FIX-D (line 337 original): stopBtn.addEventListener on null. Same issue.
 *
 *   FIX-E (line 122 original): inviteBtn pointed to id="inviteBtn" which
 *          doesn't exist in timer.html. Correct IDs are inviteWhatsapp/copyInvite.
 *          The invite block was wired to a ghost element and never fired.
 *
 *   FIX-F (line 440+507 original): Two separate onSnapshot(collection(db,"users"))
 *          calls — merged into one to halve Firestore reads.
 *
 *   FIX-G (line 636+727 original): Two unfiltered onSnapshot on full messages
 *          collection — filtered to roomId and de-duplicated into one listener.
 *
 *   FIX-H (line 737 original): getToken called during DOMContentLoaded before
 *          onAuthStateChanged resolved. currentUser was "" so token was saved
 *          under an empty Firestore key. Moved inside onAuthStateChanged.
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS — everything from firebase.js; no initializeApp() here
// FIX-A: removed "import { initializeApp }" and the initializeApp() call
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
// MODULE-LEVEL CONSTANTS (safe before DOMContentLoaded)
// ─────────────────────────────────────────────────────────────────────────────

const VAPID_KEY = "BDTkDBt3daAUhVvkAHvKuEJn1DI6MwZh5nYzMFu8ym7UQGKNaAbzCtH-RE6DiHCv3k22w_mfl7u8jY-KqN5aNpc";

// Register FCM service worker (must be named firebase-messaging-sw.js)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then(reg => console.log("[SW] FCM worker ready:", reg.scope))
    .catch(err => console.warn("[SW] FCM registration error:", err));
}

// Room from URL query param
const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "default";

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — all DOM wiring and Firestore listeners live here
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentUser  = "";
  let timerInterval;
  let seconds      = 0;
  let isRunning    = false;
  let mode         = "stopwatch";
  let initialSeconds = 0;
  let chattingWith = "";
  let lastWaveTime = 0;
  let lastMsgTime  = Date.now();

  // Singleton guard — prevents duplicate Firestore listeners on HMR / SW cache
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

  // ── DOM references ─────────────────────────────────────────────────────────

  // FIX-B: loginOverlay is null on timer.html — every access below is guarded
  const loginOverlay  = qs("loginOverlay");
  const display       = qs("display");
  const ring          = qs("ring");
  const modeLabel     = qs("modeLabel");
  // FIX-C / FIX-D: startBtn and stopBtn may be null on pages other than timer.html
  const startBtn      = qs("startBtn");
  const stopBtn       = qs("stopBtn");
  const menuToggle    = qs("menuToggle");
  const navMenu       = qs("navMenu");
  const openPanelBtn  = qs("openPanelBtn");
  const closePanelBtn = qs("closePanelBtn");
  const socialSheet   = qs("socialSheet");
  const backdrop      = qs("backdrop");
  const userList      = qs("userList");
  const progressLink  = qs("progressLink");
  const statusCard    = qs("statusCard");

  const savedName = localStorage.getItem("userName");
  if (savedName) {
    currentUser = savedName;
    if (loginOverlay) loginOverlay.style.display = "none"; // FIX-B: guarded
  }

  if (progressLink) {
    progressLink.addEventListener("click", () => {
      window.location.href = "leaderboard.html";
    });
  }

  if (statusCard) {
    statusCard.addEventListener("click", () => {
      window.location.href = "leaderboard.html";
    });
  }

  // ── Firebase Auth ──────────────────────────────────────────────────────────

  onAuthStateChanged(auth, async user => {

    if (!user) {
      // FIX-B: loginOverlay is null on timer.html — guard prevents TypeError
      if (loginOverlay) loginOverlay.style.display = "flex";
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

    // FIX-H: FCM token acquired HERE, after user is confirmed
    //        Original code ran Notification.requestPermission() during
    //        DOMContentLoaded before auth resolved — currentUser was ""
    //        so the token was stored under an empty Firestore document key.
    if (Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
    if (Notification.permission === "granted") {
      try {
        const token = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (token) {
          await updateDoc(doc(db, "users", currentUser), { fcmToken: token });
          console.log("[FCM] Token saved for", currentUser);
        }
      } catch (err) {
        console.warn("[FCM] getToken error:", err);
      }
    }

    // Attach Firestore listeners only after we know who the user is
    if (!listenersAttached) {
      listenersAttached = true;
      attachListeners();
    }
  });

  // ── Room Create / Join ─────────────────────────────────────────────────────

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
      location.href = `/timer?room=${newRoomId}`;
    };
  }

  const joinModal  = qs("joinModal");
  const joinRoomBtn = qs("joinRoomBtn");
  const confirmJoin = qs("confirmJoin");

  if (joinRoomBtn && joinModal) {
    joinRoomBtn.onclick = () => { joinModal.style.display = "flex"; };
  }

  if (confirmJoin) {
    confirmJoin.onclick = async () => {
      const id = (qs("joinRoomInput")?.value || "").trim();
      if (!id) { alert("Enter Room ID"); return; }
      const snap = await getDoc(doc(db, "rooms", id));
      if (!snap.exists()) { alert("Room not found ❌"); return; }
      await updateDoc(doc(db, "users", currentUser), { room: id });
      location.href = `/timer?room=${id}`;
    };
  }

  // Close modals
  document.querySelectorAll(".closeModal").forEach(btn => {
    btn.addEventListener("click", () => {
      if (createModal) createModal.style.display = "none";
      if (joinModal)   joinModal.style.display   = "none";
    });
  });

  // ── Timer Logic ────────────────────────────────────────────────────────────

  // FIX-C: startBtn null-guard — index.html loads this script but has no #startBtn
  if (startBtn) {
    startBtn.addEventListener("click", async () => {

      if (!currentUser) { alert("Login first"); return; }

      const currentWeek = getWeekNumber();
      const userRef     = doc(db, "users", currentUser);
      const snap        = await getDoc(userRef);

      if (snap.exists() && snap.data().lastActiveWeek !== currentWeek) {
        await updateDoc(userRef, {
          weeklyXP: 0, focusTime: 0, lastActiveWeek: currentWeek
        });
      }

      await updateDoc(doc(db, "users", currentUser), { status: "Focusing 👋" });

      if (!isRunning) {
        isRunning = true;
        startBtn.style.display = "none";
        if (stopBtn)  stopBtn.style.display  = "block";
        if (ring)     ring.classList.add("active");

        timerInterval = setInterval(async () => {
          if (mode === "countdown") {
            if (seconds > 0) { seconds--; updateDisplay(); }
            else { finishTimer(); }
          } else {
            seconds++;
            updateDisplay();
            if (seconds % 60 === 0 && isRunning) {
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

  // FIX-D: stopBtn null-guard
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      clearInterval(timerInterval);
      isRunning = false;

      const mins = Math.floor(seconds / 60);
      if (mins > 0) {
        await updateDoc(doc(db, "users", currentUser), {
          status: "Online", focusTime: increment(mins)
        });
      } else {
        await updateDoc(doc(db, "users", currentUser), { status: "Online" });
      }

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

  // ── Panel & Menu ───────────────────────────────────────────────────────────

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
  }

  // FIX-E: inviteBtn was wired to id="inviteBtn" which doesn't exist in timer.html.
  //        The actual buttons are id="inviteWhatsapp" and id="copyInvite".
  //        Wired directly — no intermediate inviteBtn variable needed.
  const inviteWhatsapp = qs("inviteWhatsapp");
  const copyInvite     = qs("copyInvite");
  const inviteLink     = `${location.origin}/timer?room=${roomId}`;
  const inviteMsg      = `📚 Focus Study Room\n\nLet's stay productive together 🚀\n\nJoin here:\n${inviteLink}`;

  if (inviteWhatsapp) {
    inviteWhatsapp.onclick = () => {
      window.open("https://wa.me/?text=" + encodeURIComponent(inviteMsg), "_blank");
    };
  }
  if (copyInvite) {
    copyInvite.onclick = async () => {
      await navigator.clipboard.writeText(inviteMsg);
      alert("Invite message copied ✅");
    };
  }

  // ── Visibility / unload ────────────────────────────────────────────────────

  window.addEventListener("visibilitychange", async () => {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser), {
      status: document.visibilityState === "hidden" ? "Offline" : "Online"
    });
  });

  window.addEventListener("beforeunload", async () => {
    if (currentUser) {
      await updateDoc(doc(db, "users", currentUser), { status: "Offline" });
    }
  });

  // ── Logout ─────────────────────────────────────────────────────────────────

  window.logoutUser = async () => {
    await signOut(auth);
    localStorage.removeItem("userName");
    location.reload();
  };

  // ── FCM foreground messages ────────────────────────────────────────────────

  onMessage(messaging, payload => {
    const { title = "Notification", body = "" } = payload.notification || {};
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png" });
    }
  });

  // ── Window-exposed functions (called from inline HTML onclick) ─────────────

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
    if (box)  box.style.display = "block";
    if (area) area.innerHTML = "<div style='text-align:center;opacity:.6'>Loading chat...</div>";
  };

  window.closeChat = () => {
    const box = qs("chatBox");
    if (box) box.style.display = "none";
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

  // ── Chat input → typing indicator ──────────────────────────────────────────

  const chatInput = qs("chatInput");
  if (chatInput) {
    chatInput.addEventListener("input", async () => {
      if (!chattingWith) return;
      await setDoc(doc(db, "typing", currentUser + "_" + chattingWith), {
        from: currentUser, to: chattingWith, typing: true, time: Date.now()
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRESTORE LISTENERS
  // Called from onAuthStateChanged once user is confirmed.
  // Singleton guard (listenersAttached) prevents duplicate attachment.
  //
  // FIX-F: Merged two separate onSnapshot(collection(db,"users")) into ONE.
  // FIX-G: Merged two unfiltered onSnapshot(collection(db,"messages")) into ONE
  //        filtered query. Cleanup moved to a one-time getDocs call.
  // ═══════════════════════════════════════════════════════════════════════════

  function attachListeners() {

    // ── Users: member list + leaderboard + wave detection ──────────────────
    // FIX-F: Was TWO separate onSnapshot(collection(db,"users")) calls.
    //        Now ONE listener handles all three responsibilities.
    onSnapshot(collection(db, "users"), snapshot => {

      // -- Member list --
      if (userList) {
        userList.innerHTML = "";
        snapshot.forEach(docSnap => {
          const u = docSnap.data();
          if (u.room !== roomId) return;
          if (u.status !== "Online" && u.status !== "Focusing 👋") return;

          userList.innerHTML += `
<div class="member-card">
  <div style="font-size:24px;margin-right:10px;">👤</div>
  <div style="flex:1">
    <div style="font-weight:bold;">${u.name}</div>
    <div style="font-size:12px;">
      <span class="status-dot ${u.status === "Online" ? "online" : "offline"}"></span>
      ${u.status}
    </div>
  </div>
  ${u.name !== currentUser ? `
  <button onclick="wave('${u.name}')"
    style="background:#00f2fe;border:none;padding:6px 12px;
           border-radius:20px;cursor:pointer;font-size:12px;">
    👋 Wave
  </button>
  <button onclick="openChat('${u.name}')"
    style="background:#00ff88;border:none;padding:6px 12px;
           border-radius:20px;cursor:pointer;font-size:12px;margin-left:5px;">
    💬 Msg
  </button>` : ""}
</div>`;
        });
      }

      // -- Leaderboard --
      const board = qs("leaderboard");
      if (board) {
        const users = [];
        snapshot.forEach(d => users.push(d.data()));
        users.sort((a, b) => (b.focusTime || 0) - (a.focusTime || 0));
        board.innerHTML = "";
        users.slice(0, 10).forEach((u, i) => {
          const h = Math.floor((u.focusTime || 0) / 60);
          const m = (u.focusTime || 0) % 60;
          const badge = i === 0 ? "💎" : i === 1 ? "🥇" : i === 2 ? "🥈" : "";
          board.innerHTML += `<div>${badge} ${u.name} — ${h}h ${m}m</div>`;
        });
      }

      // -- Wave detection --
      snapshot.forEach(docSnap => {
        const u = docSnap.data();
        if (u.waveFrom && u.name === currentUser && u.waveTime > lastWaveTime) {
          lastWaveTime = u.waveTime;
          const pop = document.createElement("div");
          pop.className = "wave-popup";
          pop.innerText = `👋 ${u.waveFrom} waved at you`;
          document.body.appendChild(pop);
          setTimeout(() => {
            pop.remove();
            updateDoc(doc(db, "users", currentUser), { waveFrom: "", waveTime: 0 });
          }, 5000);
        }
      });
    });

    // ── Chat messages (room-filtered) ───────────────────────────────────────
    onSnapshot(
      query(collection(db, "messages"), where("room", "==", roomId), orderBy("time")),
      snap => {
        const chatArea = qs("chatMessages");
        if (!chatArea) return;
        chatArea.innerHTML = "";
        snap.forEach(d => {
          const m = d.data();
          if (
            (m.from === currentUser && m.to === chattingWith) ||
            (m.from === chattingWith && m.to === currentUser)
          ) {
            chatArea.innerHTML += `
<div class="${m.from === currentUser ? "msg-me" : "msg-other"}">
  <b>${m.from}</b> ${m.text}
  <span style="font-size:10px;margin-left:6px;">
    ${m.status === "seen" || m.status === "delivered" ? "✔✔" : "✔"}
  </span>
</div>`;
            if (m.to === currentUser && m.status === "sent") {
              updateDoc(doc(db, "messages", d.id), { status: "delivered" });
            }
            if (m.to === currentUser && m.from === chattingWith) {
              updateDoc(doc(db, "messages", d.id), { status: "seen" });
            }
          }
        });
      }
    );

    // ── Message notifications (room + recipient filtered) ──────────────────
    // FIX-G: Was onSnapshot(collection(db,"messages")) scanning ALL messages.
    //        Now filtered to this room and this user as recipient.
    onSnapshot(
      query(
        collection(db, "messages"),
        where("room", "==", roomId),
        where("to", "==", currentUser),
        orderBy("time")
      ),
      snap => {
        snap.forEach(d => {
          const m = d.data();
          if (m.from === currentUser || m.time <= lastMsgTime) return;
          lastMsgTime = m.time;

          const box = qs("chatNotify");
          const txt = qs("notifyText");
          if (!box || !txt) return;

          txt.innerText = `${m.from}: ${m.text}`;
          box.style.display = "block";
          setTimeout(() => { box.style.display = "none"; }, 4000);
        });
      }
    );

    // ── Typing indicator ────────────────────────────────────────────────────
    onSnapshot(collection(db, "typing"), snap => {
      snap.forEach(d => {
        const t = d.data();
        if (t.to !== currentUser || t.from !== chattingWith) return;
        let el = qs("typingIndicator");
        if (!el) {
          el = document.createElement("div");
          el.id = "typingIndicator";
          el.style.cssText = "opacity:.7;font-size:12px;";
          el.innerText = t.from + " typing...";
          qs("chatMessages")?.appendChild(el);
        }
        setTimeout(() => el?.remove(), 2000);
      });
    });

    // ── Stale message cleanup (one-time getDocs, not a live listener) ───────
    // FIX-G: Was a live onSnapshot scanning ALL messages every change.
    //        Replaced with a one-time getDocs call on login — much cheaper.
    getDocs(query(collection(db, "messages"), where("room", "==", roomId)))
      .then(snap => {
        snap.forEach(async d => {
          if (Date.now() - d.data().time > 172800000) {
            await deleteDoc(doc(db, "messages", d.id));
          }
        });
      });
  }

}); // end DOMContentLoaded
