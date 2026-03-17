/**
 * script.js — Untitled World Focus Timer (FIXED v3)
 *
 * All original FIX-A through FIX-H preserved.
 *
 * NEW FIXES in v3:
 *   FIX-1 : Global Room panel — openGlobalPanel() shows ALL users (name, focusTime, weeklyXP)
 *   FIX-2 : initRoomUI() — correct show/hide for joinCreateRow vs inRoomRow
 *   FIX-3 : openPanelBtn (Group Study Room box) is correctly shown/hidden
 *   FIX-4 : Social sheet — sections: Live Members (scrollable) + Leaderboard (fixed bottom)
 *   FIX-5 : _setTimerMode is bridge for custom modal confirm
 *   FIX-6 : Timer display always reflects real seconds — no stale state
 *   FIX-8 : Music logic is in timer.html (localStorage); this file wires panel button IDs
 *   FIX-PANEL: socialSheet handles both global and room modes via panelMode flag
 */

// ─── IMPORTS (FIX-A: no duplicate initializeApp) ─────────────────────────────
import { db, auth, messaging, getToken, onMessage } from "./firebase.js";

import {
  collection, addDoc, onSnapshot,
  doc, setDoc, updateDoc, increment, deleteDoc,
  query, orderBy, getDocs, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const VAPID_KEY = "BDTkDBt3daAUhVvkAHvKuEJn1DI6MwZh5nYzMFu8ym7UQGKNaAbzCtH-RE6DiHCv3k22w_mfl7u8jY-KqN5aNpc";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/firebase-messaging-sw.js")
    .then(r => console.log("[SW] ready:", r.scope))
    .catch(e => console.warn("[SW]", e));
}

const params = new URLSearchParams(location.search);
const roomId  = params.get("room") || "default";

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // ── State ───────────────────────────────────────────────────────────────────
  let currentUser       = "";
  let timerInterval;
  let seconds           = 0;
  let isRunning         = false;
  let mode              = "stopwatch";
  let initialSeconds    = 0;
  let savedMinutes      = 0;
  let chattingWith      = "";
  let lastWaveTime      = 0;
  let lastMsgTime       = Date.now();
  let listenersAttached = false;
  let panelMode         = "room"; // "global" | "room"

  // ── FIX-3: Restore timer state from sessionStorage after reload ─────────────
  const TIMER_KEY = "uw_timer_state";
  function saveTimerState() {
    if (!isRunning) return;
    try {
      sessionStorage.setItem(TIMER_KEY, JSON.stringify({
        seconds, mode, initialSeconds, savedMinutes,
        startedAt: Date.now() - (seconds * 1000)
      }));
    } catch {}
  }
  function restoreTimerState() {
    try {
      const raw = sessionStorage.getItem(TIMER_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || !s.startedAt) return;
      // Calculate real elapsed time since page loaded
      const elapsed = Math.floor((Date.now() - s.startedAt) / 1000);
      mode           = s.mode || "stopwatch";
      initialSeconds = s.initialSeconds || 0;
      savedMinutes   = s.savedMinutes   || 0;
      if (mode === "countdown") {
        seconds = Math.max(0, initialSeconds - elapsed);
      } else {
        seconds = elapsed;
      }
      updateDisplay();
      const lbl = document.getElementById("modeLabel");
      if (lbl) {
        if (mode === "stopwatch") lbl.textContent = "STOPWATCH MODE";
        else {
          const h = Math.floor(initialSeconds/3600), m = Math.floor((initialSeconds%3600)/60);
          lbl.textContent = (h>0 ? h+"h " : "") + m + "m COUNTDOWN";
        }
      }
      // Mark custom button active if countdown
      if (mode === "countdown") {
        document.querySelectorAll(".preset-btn").forEach(b=>b.classList.remove("active"));
        document.getElementById("btnCustom")?.classList.add("active");
      }
    } catch {}
  }
  function clearTimerState() {
    try { sessionStorage.removeItem(TIMER_KEY); } catch {}
  }
  restoreTimerState();

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const qs = id => document.getElementById(id);

  function updateDisplay() {
    const d = qs("display");
    if (!d) return;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    d.innerText = `${m < 10 ? "0"+m : m}:${s < 10 ? "0"+s : s}`;
  }

  function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  function getWeekNumber() {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 4 - (d.getDay()||7));
    const ys = new Date(d.getFullYear(),0,1);
    return `${d.getFullYear()}-W${Math.ceil((((d-ys)/86400000)+1)/7)}`;
  }

  function showToast(msg) {
    const el = document.createElement("div");
    el.className = "toast-msg";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function formatTime(totalMin) {
    const h = Math.floor((totalMin||0)/60);
    const m = (totalMin||0)%60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ── FIX-5/FIX-6: Timer mode bridge (used by custom modal & setMode) ─────────
  window._setTimerMode = (m, initSecs) => {
    mode = m;
    initialSeconds = (m === "countdown") ? initSecs : 0;
    seconds        = initialSeconds;       // FIX-6: always set correct seconds
    if (!isRunning) updateDisplay();
  };

  // ── DOM Refs ─────────────────────────────────────────────────────────────────
  const loginOverlay  = qs("loginOverlay");  // FIX-B
  const display       = qs("display");
  const ring          = qs("ring");
  const modeLabel     = qs("modeLabel");
  const startBtn      = qs("startBtn");      // FIX-C
  const stopBtn       = qs("stopBtn");       // FIX-D
  const menuToggle    = qs("menuToggle");
  const navMenu       = qs("navMenu");
  const socialSheet   = qs("socialSheet");
  const backdrop      = qs("backdrop");
  const userList      = qs("userList");
  const statusCard    = qs("statusCard");

  // FIX-2: Room section refs
  const joinCreateRow  = qs("joinCreateRow");
  const inRoomRow      = qs("inRoomRow");
  const roomBadge      = qs("roomBadge");
  const exitRoomBtn    = qs("exitRoomBtn");
  const exitSessionBtn = qs("exitSessionBtn");
  const globalBox      = qs("globalBox");
  const openPanelBtn   = qs("openPanelBtn"); // FIX-3

  // Load saved user
  const savedName = localStorage.getItem("userName");
  if (savedName) {
    currentUser = savedName;
    if (loginOverlay) loginOverlay.style.display = "none"; // FIX-B
  }

  if (statusCard) statusCard.addEventListener("click", () => { window.location.href="leaderboard.html"; });

  // ── FIX-2: Room UI initialiser ───────────────────────────────────────────────
  function initRoomUI() {
    const inRoom = roomId !== "default";
    // Room buttons
    if (joinCreateRow) joinCreateRow.style.display = inRoom ? "none" : "flex";
    if (inRoomRow)     inRoomRow.style.display     = inRoom ? "flex" : "none";
    // FIX-1 & FIX-3: session boxes
    if (globalBox)    globalBox.style.display    = inRoom ? "none" : "block";
    if (openPanelBtn) openPanelBtn.style.display = inRoom ? "block" : "none";
    // Badge label
    if (inRoom && roomBadge) {
      const label = roomId.replace(/_[a-z0-9]{3,5}$/i, "");
      roomBadge.textContent = "📚 " + label;
    }
  }
  initRoomUI();

  // FIX-2: Exit Room & Exit Session
  window.exitRoom = async () => {
    if (currentUser) {
      try { await updateDoc(doc(db,"users",currentUser),{room:"default"}); } catch {}
    }
    window.location.href = location.pathname;
  };
  window.exitToGlobal = window.exitRoom;

  if (exitRoomBtn)    exitRoomBtn.addEventListener("click",    window.exitRoom);
  if (exitSessionBtn) exitSessionBtn.addEventListener("click", window.exitRoom);

  // ── FIX-1: Global Panel ──────────────────────────────────────────────────────
  window._openGlobalSheet = () => {
    panelMode = "global";
    const title = qs("panelTitle");
    const lbT   = qs("lbTitle");
    const invWA = qs("inviteWhatsapp");
    const invCP = qs("copyInvite");
    if (title) title.textContent = "🌍 Global Room";
    if (lbT)   lbT.textContent   = "🏆 Global Leaderboard";
    if (invWA) invWA.style.display = "none";
    if (invCP) invCP.style.display = "none";
    if (socialSheet) socialSheet.classList.add("open");
    if (backdrop)    backdrop.style.display = "block";
    renderPanelUsers();
  };

  // FIX-4: Room Panel
  window._openRoomSheet = () => {
    panelMode = "room";
    const title = qs("panelTitle");
    const lbT   = qs("lbTitle");
    const invWA = qs("inviteWhatsapp");
    const invCP = qs("copyInvite");
    if (title) title.textContent = "👥 Live Members";
    if (lbT)   lbT.textContent   = "🏅 Room Leaderboard";
    if (invWA) invWA.style.display = "";
    if (invCP) invCP.style.display = "";
    if (socialSheet) socialSheet.classList.add("open");
    if (backdrop)    backdrop.style.display = "block";
    renderPanelUsers();
  };

  // Cached messages for instant chat open (FIX-8)
  let _msgCache = [];

  // FIX-8: render messages for a given pair from cache immediately
  function renderChatForPair(withUser) {
    const chatArea = qs("chatMessages");
    if (!chatArea) return;
    const msgs = _msgCache.filter(msg =>
      (msg.from===currentUser && msg.to===withUser) ||
      (msg.from===withUser    && msg.to===currentUser)
    );
    if (!msgs.length) {
      chatArea.innerHTML = `<div style="text-align:center;opacity:.35;font-size:12px;padding:20px">No messages yet. Say hi! 👋</div>`;
      return;
    }
    chatArea.innerHTML = "";
    msgs.forEach(msg => {
      const seen = msg.status==="seen";
      const del  = msg.status==="delivered";
      const tick = seen
        ? '<span style="color:var(--blue);font-size:10px;margin-left:5px">✔✔</span>'
        : del
          ? '<span style="opacity:.5;font-size:10px;margin-left:5px">✔✔</span>'
          : '<span style="opacity:.4;font-size:10px;margin-left:5px">✔</span>';
      const bubble = document.createElement("div");
      if (msg.from===currentUser) {
        bubble.className = "msg-me";
        bubble.innerHTML = `${msg.text}${tick}`;
      } else {
        bubble.className = "msg-other";
        bubble.innerHTML = `<span style="font-size:10px;opacity:.55">${msg.from}</span><br>${msg.text}`;
      }
      chatArea.appendChild(bubble);
    });
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  // Cached snapshot data for panel rendering
  let _allUsersCache = [];
    if (!userList) return;
    userList.innerHTML = "";

    const users = panelMode === "global"
      ? _allUsersCache.filter(u => u.status === "Online" || u.status === "Focusing 👋")
      : _allUsersCache.filter(u => u.room === roomId);

    if (!users.length) {
      userList.innerHTML = `<div style="text-align:center;opacity:.4;font-size:13px;padding:24px">
        ${panelMode==="global"?"No one online right now.":"No members yet — share the invite link 🔗"}</div>`;
      return;
    }

    users.forEach(u => {
      const isMe   = u.name === currentUser;
      const dotCls = u.status==="Focusing 👋" ? "s-focus" : u.status==="Online" ? "s-online" : "s-offline";
      const h = Math.floor((u.focusTime||0)/60), m = (u.focusTime||0)%60;
      const timeStr = h>0 ? `${h}h ${m}m` : `${m}m`;
      const xp = u.weeklyXP||0;

      const card = document.createElement("div");
      card.className = "member-card";
      card.innerHTML = `
        <div class="member-av">${(u.name||"?")[0].toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">
            ${u.name||"User"}${isMe?'&nbsp;<span style="color:var(--blue);font-size:10px">(You)</span>':''}
          </div>
          <div class="member-stat">
            <span class="sdot ${dotCls}"></span>
            <span>${u.status}</span>
            <span style="margin-left:4px;color:var(--blue)">· ${timeStr}</span>
            ${panelMode==="global" ? `<span style="margin-left:4px;color:gold">· ⭐${xp}</span>` : ""}
          </div>
        </div>
        ${!isMe && panelMode==="room" ? `
        <div class="member-acts">
          <button class="mact wave" onclick="wave('${u.name}')">👋</button>
          <button class="mact chat" onclick="openChat('${u.name}')">💬</button>
        </div>` : ""}`;
      userList.appendChild(card);
    });
  }

  // Room/Global Leaderboard in panel (FIX-4 + room filter fix)
  function renderPanelLeaderboard() {
    const board = qs("leaderboard");
    if (!board) return;

    // FIX: room panel → only users in this room
    //      global panel → all users
    const source = panelMode === "room"
      ? _allUsersCache.filter(u => u.room === roomId)
      : _allUsersCache;

    const sorted = [...source]
      .sort((a,b)=>(b.focusTime||0)-(a.focusTime||0))
      .slice(0,10);
    board.innerHTML = "";
    if (!sorted.length) {
      board.innerHTML = `<div style="text-align:center;opacity:.35;font-size:12px;padding:12px">No data yet</div>`;
      return;
    }
    sorted.forEach((u,i) => {
      const h = Math.floor((u.focusTime||0)/60), m = (u.focusTime||0)%60;
      const timeStr = h>0 ? `${h}h ${m}m` : `${m}m`;
      const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;
      const isMe  = u.name===currentUser;
      const el = document.createElement("div");
      if (isMe) el.style.borderColor="rgba(0,242,254,.35)";
      el.innerHTML = `<span>${medal} ${u.name||"User"}${isMe?" (You)":""}</span><span>${timeStr}</span>`;
      board.appendChild(el);
    });
  }

  // ─── Firebase Auth ───────────────────────────────────────────────────────────
  onAuthStateChanged(auth, async user => {
    if (!user) {
      if (loginOverlay) loginOverlay.style.display = "flex"; // FIX-B
      return;
    }

    currentUser = user.displayName || user.email || "";
    localStorage.setItem("userName", currentUser);
    if (loginOverlay) loginOverlay.style.display = "none"; // FIX-B

    const today = getTodayDate(), week = getWeekNumber();
    const uRef  = doc(db,"users",currentUser);
    const snap  = await getDoc(uRef);

    if (snap.exists() && snap.data().lastActiveDate !== today) {
      await updateDoc(uRef,{focusTime:0,lastActiveDate:today});
    }
    await setDoc(uRef,{
      name:currentUser, email:user.email,
      status:"Online", room:roomId,
      lastActiveDate:today, lastActiveWeek:week
    },{merge:true});

    // FIX-H: FCM after auth
    if (Notification.permission==="default") await Notification.requestPermission().catch(()=>{});
    if (Notification.permission==="granted") {
      try {
        const token = await getToken(messaging,{vapidKey:VAPID_KEY});
        if (token) await updateDoc(doc(db,"users",currentUser),{fcmToken:token});
      } catch(e){ console.warn("[FCM]",e); }
    }

    if (!listenersAttached){ listenersAttached=true; attachListeners(); }

    // FIX-3: If timer was running before reload, auto-resume it
    const prevState = sessionStorage.getItem(TIMER_KEY);
    if (prevState && !isRunning && startBtn) {
      // Small delay so UI is ready
      setTimeout(() => { if (!isRunning) startBtn.click(); }, 400);
    }
  });

  // ─── Room Create / Join ──────────────────────────────────────────────────────
  const createModal   = qs("createModal");
  const createRoomBtn = qs("createRoomBtn");
  const confirmCreate = qs("confirmCreate");

  if (createRoomBtn && createModal) {
    createRoomBtn.onclick = () => { createModal.style.display="flex"; };
  }
  if (confirmCreate) {
    confirmCreate.onclick = async () => {
      const name = (qs("roomName")?.value||"").trim();
      if (!name){ showToast("Enter room name"); return; }
      const newId = name + "_" + Math.random().toString(36).slice(2,5);
      await setDoc(doc(db,"rooms",newId),{name,createdBy:currentUser,createdAt:Date.now()});
      await updateDoc(doc(db,"users",currentUser),{room:newId});
      location.href = location.pathname+"?room="+newId;
    };
  }

  const joinModal   = qs("joinModal");
  const joinRoomBtn = qs("joinRoomBtn");
  const confirmJoin = qs("confirmJoin");

  if (joinRoomBtn && joinModal) {
    joinRoomBtn.onclick = () => {
      qs("joinError").style.display="none";
      joinModal.style.display="flex";
    };
  }
  if (confirmJoin) {
    confirmJoin.onclick = async () => {
      const id = (qs("joinRoomInput")?.value||"").trim();
      if (!id){ showToast("Enter Room ID"); return; }
      const snap = await getDoc(doc(db,"rooms",id));
      if (!snap.exists()){
        qs("joinError").style.display="block";
        return;
      }
      await updateDoc(doc(db,"users",currentUser),{room:id});
      location.href = location.pathname+"?room="+id;
    };
  }

  // ─── Timer Logic (ORIGINAL — preserved exactly) ─────────────────────────────

  // FIX-C: null-guard
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      if (!currentUser){ showToast("Login first"); return; }

      const week  = getWeekNumber();
      const uRef  = doc(db,"users",currentUser);
      const snap  = await getDoc(uRef);
      if (snap.exists() && snap.data().lastActiveWeek !== week) {
        await updateDoc(uRef,{weeklyXP:0,lastActiveWeek:week});
      }
      await updateDoc(doc(db,"users",currentUser),{status:"Focusing 👋"});

      if (!isRunning) {
        isRunning    = true;
        savedMinutes = 0;
        startBtn.style.display = "none";
        if (stopBtn) stopBtn.style.display  = "block";
        if (ring)    ring.classList.add("active");

        timerInterval = setInterval(async () => {
          if (mode === "countdown") {
            if (seconds > 0){ seconds--; updateDisplay(); saveTimerState(); }
            else { finishTimer(); }
          } else {
            seconds++;
            updateDisplay();
            saveTimerState(); // FIX-3: persist every tick
            if (seconds%60===0 && isRunning) {
              savedMinutes++;
              await updateDoc(doc(db,"users",currentUser),{status:"Focusing 👋",focusTime:increment(1)});
            }
            if (seconds%120===0 && isRunning) {
              await updateDoc(doc(db,"users",currentUser),{weeklyXP:increment(1)});
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
      const totalMins   = Math.floor(seconds/60);
      const unsavedMins = totalMins - savedMinutes;
      if (unsavedMins>0) {
        await updateDoc(doc(db,"users",currentUser),{status:"Online",focusTime:increment(unsavedMins)});
      } else {
        await updateDoc(doc(db,"users",currentUser),{status:"Online"});
      }
      savedMinutes = 0;
      clearTimerState(); // FIX-3
      if (startBtn) startBtn.style.display="block";
      stopBtn.style.display="none";
      if (ring) ring.classList.remove("active");
      // FIX-6: reset to correct initial state
      seconds = mode==="countdown" ? initialSeconds : 0;
      if (mode!=="countdown" && display) display.innerText="00:00";
      updateDisplay();
    });
  }

  function finishTimer() {
    clearInterval(timerInterval);
    isRunning = false;
    const totalMins   = Math.floor((initialSeconds-seconds)/60);
    const unsavedMins = totalMins - savedMinutes;
    if (unsavedMins>0 && currentUser) {
      updateDoc(doc(db,"users",currentUser),{status:"Online",focusTime:increment(unsavedMins)}).catch(()=>{});
    }
    savedMinutes = 0;
    clearTimerState(); // FIX-3
    if (startBtn) startBtn.style.display="block";
    if (stopBtn)  stopBtn.style.display="none";
    if (ring)     ring.classList.remove("active");
    seconds = initialSeconds;
    updateDisplay();
    if (Notification.permission==="granted") {
      new Notification("Session Complete! 🎉",{body:"Great focus session!",icon:"/icon-192.png"});
    }
  }

  // ─── Panel & Menu ────────────────────────────────────────────────────────────
  function closePanel() {
    if (socialSheet) socialSheet.classList.remove("open");
    if (backdrop)    backdrop.style.display="none";
  }

  const closePanelBtn = qs("closePanelBtn");
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

  // FIX-E: Invite buttons (room mode only)
  const inviteWhatsapp = qs("inviteWhatsapp");
  const copyInvite     = qs("copyInvite");
  const inviteLink     = `${location.origin}${location.pathname}?room=${roomId}`;
  const inviteMsg      = `📚 Focus Study Room\n\nJoin here:\n${inviteLink}`;

  if (inviteWhatsapp) {
    inviteWhatsapp.onclick = () => window.open("https://wa.me/?text="+encodeURIComponent(inviteMsg),"_blank");
  }
  if (copyInvite) {
    copyInvite.onclick = async () => {
      try { await navigator.clipboard.writeText(inviteLink); }
      catch {
        const ta=document.createElement("textarea"); ta.value=inviteLink;
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      showToast("✅ Invite link copied!");
    };
  }

  // ─── Visibility / Unload ─────────────────────────────────────────────────────
  window.addEventListener("visibilitychange", async () => {
    if (!currentUser) return;
    await updateDoc(doc(db,"users",currentUser),{
      status: document.visibilityState==="hidden" ? "Offline" : "Online"
    }).catch(()=>{});
  });
  window.addEventListener("beforeunload", () => {
    if (currentUser) updateDoc(doc(db,"users",currentUser),{status:"Offline"}).catch(()=>{});
  });

  // ─── Logout ──────────────────────────────────────────────────────────────────
  window.logoutUser = async () => {
    await signOut(auth);
    localStorage.removeItem("userName");
    location.reload();
  };

  // ─── FCM foreground ──────────────────────────────────────────────────────────
  onMessage(messaging, payload => {
    const {title="Notification",body=""} = payload.notification||{};
    if (Notification.permission==="granted") new Notification(title,{body,icon:"/icon-192.png"});
  });

  // ─── Window-exposed chat helpers ─────────────────────────────────────────────
  window.wave = async name => {
    await updateDoc(doc(db,"users",name),{waveFrom:currentUser,waveTime:Date.now()});
  };

  window.openChat = name => {
    chattingWith = name;
    const box  = qs("chatBox");
    const area = qs("chatMessages");
    const lbl  = qs("chatWithLabel");
    if (box)  { box.style.display="flex"; box.classList.add("open"); }
    if (lbl)  lbl.textContent = "💬 " + name;
    // FIX-8: render existing messages immediately from live listener
    // The onSnapshot listener for messages keeps rendering automatically —
    // but we force a redraw now by setting chattingWith first, then triggering
    // the existing snapshot callback via renderChatForPair()
    if (area) {
      area.innerHTML = `<div style="text-align:center;opacity:.4;font-size:12px;padding:16px">Loading...</div>`;
      renderChatForPair(name);
    }
  };

  window.closeChat = () => {
    const box = qs("chatBox");
    if (box){ box.style.display="none"; box.classList.remove("open"); }
  };

  window.sendMsg = async () => {
    const input = qs("chatInput");
    const txt   = input?.value?.trim();
    if (!txt||!chattingWith) return;
    await addDoc(collection(db,"messages"),{
      from:currentUser, to:chattingWith,
      text:txt, room:roomId, time:Date.now(), status:"sent"
    });
    if (input) input.value="";
  };

  const chatInput = qs("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e=>{ if(e.key==="Enter") window.sendMsg(); });
    chatInput.addEventListener("input", async () => {
      if (!chattingWith) return;
      await setDoc(doc(db,"typing",currentUser+"_"+chattingWith),{
        from:currentUser, to:chattingWith, typing:true, time:Date.now()
      }).catch(()=>{});
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRESTORE LISTENERS
  // FIX-F: single onSnapshot for users
  // FIX-G: messages filtered
  // ═══════════════════════════════════════════════════════════════════════════

  function attachListeners() {

    // ── Users (FIX-F: one listener for all) ───────────────────────────────
    onSnapshot(collection(db,"users"), snapshot => {
      _allUsersCache = snapshot.docs.map(d=>({id:d.id,...d.data()}));

      // FIX-1: Update global box preview (top 5 focusing users)
      const globalUsersEl = qs("globalUsers");
      if (globalUsersEl && roomId === "default") {
        const focusing = _allUsersCache
          .filter(u=>u.status==="Focusing 👋")
          .sort((a,b)=>(b.focusTime||0)-(a.focusTime||0))
          .slice(0,5);

        if (!focusing.length) {
          globalUsersEl.innerHTML = `<div class="no-focus-msg">Start focusing to appear here 🚀</div>`;
        } else {
          globalUsersEl.innerHTML = focusing.map(u => {
            const h=Math.floor((u.focusTime||0)/60), m=(u.focusTime||0)%60;
            const t = h>0?`${h}h ${m}m`:`${m}m`;
            return `<div class="g-row">
              <div class="g-left"><span class="focus-dot"></span><span>${u.name||"User"}</span></div>
              <span class="g-time">${t}</span>
            </div>`;
          }).join("");
        }
      }

      // Re-render open panel
      if (socialSheet?.classList.contains("open")) {
        renderPanelUsers();
        renderPanelLeaderboard();
      }

      // Wave detection
      _allUsersCache.forEach(u => {
        if (u.waveFrom && u.name===currentUser && u.waveTime>lastWaveTime) {
          lastWaveTime = u.waveTime;
          const container = qs("wavePopupContainer")||document.body;
          const pop = document.createElement("div");
          pop.className = "wave-popup";
          pop.textContent = `👋 ${u.waveFrom} waved at you!`;
          container.appendChild(pop);
          setTimeout(()=>{
            pop.remove();
            updateDoc(doc(db,"users",currentUser),{waveFrom:"",waveTime:0}).catch(()=>{});
          }, 3500);
        }
      });
    });

    // ── Chat messages (FIX-G: room filtered + FIX-8: cache for instant open) ──
    onSnapshot(
      query(collection(db,"messages"), where("room","==",roomId), orderBy("time")),
      snap => {
        // FIX-8: populate cache so openChat can render immediately
        _msgCache = snap.docs.map(d => ({id:d.id,...d.data()}));

        const chatArea = qs("chatMessages");
        // Re-render if chat is open
        if (chatArea && qs("chatBox")?.classList.contains("open") && chattingWith) {
          renderChatForPair(chattingWith);
        }
        // Mark messages seen/delivered
        snap.forEach(d => {
          const msg = d.data();
          if (msg.to===currentUser && msg.status==="sent")
            updateDoc(doc(db,"messages",d.id),{status:"delivered"}).catch(()=>{});
          if (msg.to===currentUser && msg.from===chattingWith && qs("chatBox")?.classList.contains("open"))
            updateDoc(doc(db,"messages",d.id),{status:"seen"}).catch(()=>{});
        });
      }
    );

    // ── Incoming message notifications (FIX-G: filtered) ─────────────────
    onSnapshot(
      query(collection(db,"messages"), where("room","==",roomId), where("to","==",currentUser), orderBy("time")),
      snap => {
        snap.forEach(d => {
          const msg = d.data();
          if (msg.from===currentUser || msg.time<=lastMsgTime) return;
          lastMsgTime = msg.time;
          const box = qs("chatNotify"), txt = qs("notifyText");
          if (!box||!txt) return;
          txt.textContent = `${msg.from}: ${msg.text}`;
          box.style.display="block";
          setTimeout(()=>{ box.style.display="none"; }, 4000);
        });
      }
    );

    // ── Typing indicator ──────────────────────────────────────────────────
    onSnapshot(collection(db,"typing"), snap => {
      snap.forEach(d => {
        const t = d.data();
        if (t.to!==currentUser || t.from!==chattingWith) return;
        let el = qs("typingIndicator");
        if (!el) {
          el = document.createElement("div");
          el.id = "typingIndicator";
          el.style.cssText = "opacity:.6;font-size:11px;padding:4px 12px;color:var(--blue);";
          el.textContent = t.from+" typing...";
          qs("chatMessages")?.appendChild(el);
        }
        setTimeout(()=>el?.remove(), 2000);
      });
    });

    // ── Stale message cleanup (FIX-G: one-time getDocs) ──────────────────
    getDocs(query(collection(db,"messages"),where("room","==",roomId)))
      .then(snap => {
        snap.forEach(async d => {
          if (Date.now()-d.data().time > 172800000) await deleteDoc(doc(db,"messages",d.id));
        });
      }).catch(()=>{});
  }

}); // end DOMContentLoaded
