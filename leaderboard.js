import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, doc,
  onSnapshot, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── Firebase init (singleton) ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:     "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain: "untitled-world-2e645.firebaseapp.com",
  projectId:  "untitled-world-2e645"
};
const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── Level system — 8 levels, 2h (60 XP) gap each ───────────────────────────
const LEVELS = [
  { min: 0,   name: "Beginner",  icon: "🌱", color: "#00e5a0", bg: "rgba(0,229,160,0.12)",  border: "rgba(0,229,160,0.3)"  },
  { min: 30,  name: "Explorer",  icon: "🔍", color: "#00e0ff", bg: "rgba(0,224,255,0.12)",  border: "rgba(0,224,255,0.3)"  },
  { min: 90,  name: "Scholar",   icon: "📚", color: "#4facfe", bg: "rgba(79,172,254,0.12)", border: "rgba(79,172,254,0.3)" },
  { min: 150, name: "Focused",   icon: "🎯", color: "#7c5cfc", bg: "rgba(124,92,252,0.12)", border: "rgba(124,92,252,0.3)" },
  { min: 210, name: "Achiever",  icon: "⚡", color: "#ffb830", bg: "rgba(255,184,48,0.12)", border: "rgba(255,184,48,0.3)" },
  { min: 270, name: "Expert",    icon: "🔥", color: "#ff7a18", bg: "rgba(255,122,24,0.12)", border: "rgba(255,122,24,0.3)" },
  { min: 330, name: "Master",    icon: "💎", color: "#ff4f6a", bg: "rgba(255,79,106,0.12)", border: "rgba(255,79,106,0.3)" },
  { min: 390, name: "Legend",    icon: "👑", color: "#ffd700", bg: "rgba(255,215,0,0.12)",  border: "rgba(255,215,0,0.35)" }
];

function getLevel(xp) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) {
    if ((xp || 0) >= l.min) lvl = l;
    else break;
  }
  return lvl;
}

function getLevelIndex(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if ((xp || 0) >= LEVELS[i].min) idx = i;
    else break;
  }
  return idx;
}

// ── Weekly reset helper ───────────────────────────────────────────────────────
function getWeekNumber() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.ceil((((d - yearStart) / 86400000) + 1) / 7)}`;
}

// Days until next Monday (weekly reset)
function daysUntilReset() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const daysLeft = day === 1 ? 7 : (8 - day) % 7;
  return daysLeft;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const podiumArea  = document.getElementById("podiumArea");
const rankList    = document.getElementById("rankList");
const loading     = document.getElementById("loading");
const myRankBar   = document.getElementById("myRankBar");
const myRankVal   = document.getElementById("myRankVal");
const myXpVal     = document.getElementById("myXpVal");
const resetTimer  = document.getElementById("resetTimer");
const levelStrip  = document.getElementById("levelStrip");

// ── Level strip ───────────────────────────────────────────────────────────────
levelStrip.innerHTML = LEVELS.map((l, i) => `
  <div class="lvl-pill">
    <span class="lvl-icon">${l.icon}</span>
    <span class="lvl-name">${l.name}</span>
    <span style="font-size:9px;color:${l.color};">${l.min} XP</span>
  </div>`).join("");

// ── Reset countdown ───────────────────────────────────────────────────────────
resetTimer.textContent = `Resets in ${daysUntilReset()} day${daysUntilReset() === 1 ? "" : "s"}`;

// ── Level up popup ────────────────────────────────────────────────────────────
function showLevelUpPopup(lvl, rank) {
  const overlay = document.createElement("div");
  overlay.className = "levelup-overlay";
  overlay.innerHTML = `
    <div class="levelup-card">
      <div class="levelup-icon">${lvl.icon}</div>
      <div class="levelup-title">You're in Top ${rank}! 🎉</div>
      <div class="levelup-sub">
        You reached <b style="color:${lvl.color};">${lvl.name}</b> level!<br>
        Keep studying to climb higher 🚀
      </div>
      <button class="levelup-btn" onclick="this.closest('.levelup-overlay').remove()">
        Keep Going!
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Track shown popup so it doesn't repeat ────────────────────────────────────
const POPUP_KEY = "uw_lb_popup_shown";
let popupShown = sessionStorage.getItem(POPUP_KEY) === "true";

// ── Main render ───────────────────────────────────────────────────────────────
function renderLeaderboard(users, currentUserName) {
  loading.style.display = "none";

  // Sort by weeklyXP desc
  const sorted = [...users]
    .filter(u => (u.weeklyXP || 0) > 0 || u.name)
    .sort((a, b) => (b.weeklyXP || 0) - (a.weeklyXP || 0))
    .slice(0, 20);

  if (!sorted.length) {
    loading.style.display = "block";
    loading.textContent = "No data this week yet.";
    return;
  }

  // ── My rank ────────────────────────────────────────────────────────────────
  const myIdx = sorted.findIndex(u => u.name === currentUserName);
  if (myIdx >= 0) {
    const me = sorted[myIdx];
    myRankBar.classList.add("visible");
    myRankVal.textContent = `#${myIdx + 1} of ${sorted.length}`;
    myXpVal.textContent   = `⭐ ${me.weeklyXP || 0} XP`;

    // Show level-up popup if in top 3 and not yet shown this session
    if (myIdx < 3 && !popupShown) {
      popupShown = true;
      sessionStorage.setItem(POPUP_KEY, "true");
      const myLvl = getLevel(me.weeklyXP || 0);
      setTimeout(() => showLevelUpPopup(myLvl, myIdx + 1), 800);
    }
  }

  // ── Podium (top 3) ─────────────────────────────────────────────────────────
  const u1 = sorted[0], u2 = sorted[1], u3 = sorted[2];

  podiumArea.innerHTML = "";
  const podium = document.createElement("div");
  podium.className = "podium-wrap";

  const buildCol = (u, rank) => {
    if (!u) return document.createElement("div");
    const lvl = getLevel(u.weeklyXP || 0);
    const col = document.createElement("div");
    col.className = "podium-col";
    col.innerHTML = `
      <div class="podium-avatar rank-${rank}">
        ${rank === 1 ? '<span class="podium-crown">👑</span>' : ""}
        ${(u.name || "?")[0].toUpperCase()}
      </div>
      <div class="podium-name">${(u.name || "—")}</div>
      <div class="podium-xp">⭐ ${u.weeklyXP || 0}</div>
      <div class="podium-lvl">${lvl.icon} ${lvl.name}</div>
      <div class="podium-bar rank-${rank}">${rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</div>`;
    return col;
  };

  // Order: 2nd (left), 1st (centre), 3rd (right)
  if (u2) podium.appendChild(buildCol(u2, 2));
  if (u1) podium.appendChild(buildCol(u1, 1));
  if (u3) podium.appendChild(buildCol(u3, 3));
  podiumArea.appendChild(podium);

  // ── Rank list 4–20 ─────────────────────────────────────────────────────────
  rankList.innerHTML = "";
  for (let i = 3; i < sorted.length; i++) {
    const u    = sorted[i];
    const rank = i + 1;
    const lvl  = getLevel(u.weeklyXP || 0);
    const isMe = u.name === currentUserName;

    const row = document.createElement("div");
    row.className = "rank-row";
    if (isMe) {
      row.style.border = `1px solid ${lvl.color}`;
      row.style.background = lvl.bg;
    }

    row.innerHTML = `
      <div class="rank-num">#${rank}</div>
      <div class="rank-avatar" style="color:${lvl.color};">
        ${(u.name || "?")[0].toUpperCase()}
      </div>
      <div class="rank-info">
        <div class="rank-name">${u.name || "—"}${isMe ? " (You)" : ""}</div>
        <div class="rank-detail">Focus: ${formatTime(u.focusTime || 0)}</div>
      </div>
      <div class="rank-right">
        <div class="rank-xp">⭐ ${u.weeklyXP || 0}</div>
        <div class="level-badge" style="background:${lvl.bg};color:${lvl.color};border:1px solid ${lvl.border};">
          ${lvl.icon} ${lvl.name}
        </div>
      </div>`;
    rankList.appendChild(row);
  }
}

function formatTime(totalMin) {
  const h = Math.floor((totalMin || 0) / 60);
  const m = (totalMin || 0) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Auth + weekly reset + live listener ───────────────────────────────────────
onAuthStateChanged(auth, async user => {

  if (!user) {
    loading.textContent = "Please log in to view the leaderboard.";
    return;
  }

  const currentUserName = user.displayName || localStorage.getItem("userName") || "";

  // ── Weekly XP reset for this user ─────────────────────────────────────────
  const currentWeek = getWeekNumber();
  try {
    const userRef  = doc(db, "users", currentUserName);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.lastActiveWeek && data.lastActiveWeek !== currentWeek) {
        await updateDoc(userRef, {
          weeklyXP: 0,
          lastActiveWeek: currentWeek
        });
      }
    }
  } catch {}

  // ── Live snapshot ─────────────────────────────────────────────────────────
  onSnapshot(collection(db, "users"), snap => {
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLeaderboard(users, currentUserName);
  }, err => {
    console.error("[Leaderboard]", err);
    loading.textContent = "Could not load leaderboard.";
  });
});
