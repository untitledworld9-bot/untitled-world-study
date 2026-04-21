/**
 * leaderboard.js — Study Grid Prep Weekly (Focus) Leaderboard
 *
 * FIXED:
 *  - Reads from "leaderboard" collection (uid-keyed) → ZERO double entries
 *  - Sorts by weeklyTimerXP → resets properly every 7 days
 *  - weeklyTimerXP resets ONLY in auth (never on focus click — that was the bug)
 *  - timerXP (cumulative) and focusTime preserved separately
 *  - getWeekNumber() kept for weekly countdown
 *  - Top-3 popup, level strip, myRankBar all preserved
 */

import { db, auth, onAuthStateChanged } from "./firebase.js";

import {
  collection, doc, onSnapshot, getDoc,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Level system (2 min focus = 1 XP, thresholds same as before) ─────────────
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

// ── Weekly helpers ────────────────────────────────────────────────────────────
function getWeekNumber() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.ceil((((d - yearStart) / 86400000) + 1) / 7)}`;
}

function daysUntilReset() {
  const day = new Date().getDay();
  return day === 1 ? 7 : (8 - day) % 7;
}

// ── DOM refs — matches leaderboard.html ───────────────────────────────────────
const podiumArea = document.getElementById("podiumArea");
const rankList   = document.getElementById("rankList");
const loading    = document.getElementById("loading");
const myRankBar  = document.getElementById("myRankBar");
const myRankVal  = document.getElementById("myRankVal");
const myXpVal    = document.getElementById("myXpVal");
const resetTimer = document.getElementById("resetTimer");
const levelStrip = document.getElementById("levelStrip");

// ── Level strip ───────────────────────────────────────────────────────────────
if (levelStrip) {
  levelStrip.innerHTML = LEVELS.map(l => `
    <div class="lvl-pill">
      <span class="lvl-icon">${l.icon}</span>
      <span class="lvl-name" style="color:${l.color};">${l.name}</span>
      <span style="font-size:9px;color:rgba(255,255,255,0.35);">${l.min} XP</span>
    </div>`).join("");
}

// ── Weekly reset countdown ────────────────────────────────────────────────────
if (resetTimer) {
  const d = daysUntilReset();
  resetTimer.textContent = `Resets in ${d} day${d === 1 ? "" : "s"}`;
}

// ── Top-3 popup ───────────────────────────────────────────────────────────────
const POPUP_KEY = "uw_lb_popup_shown";
let   popupShown = sessionStorage.getItem(POPUP_KEY) === "true";

function showTopPopup(lvl, rank) {
  const overlay = document.createElement("div");
  overlay.className = "levelup-overlay";
  overlay.innerHTML = `
    <div class="levelup-card">
      <div class="levelup-icon">${lvl.icon}</div>
      <div class="levelup-title">🔥 You are in Top ${rank}!</div>
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

// ── Format helpers ────────────────────────────────────────────────────────────
function formatTime(totalMin) {
  const h = Math.floor((totalMin || 0) / 60);
  const m = (totalMin || 0) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Main render ───────────────────────────────────────────────────────────────
// entries: [{uid, name, weeklyTimerXP, focusTime, rank}]
// currentUid: Firebase UID
function renderLeaderboard(entries, currentUid) {
  if (loading) loading.style.display = "none";

  if (!entries.length) {
    if (loading) {
      loading.style.display = "block";
      loading.innerHTML = `<div style="padding:40px;color:rgba(255,255,255,0.4);font-size:14px;">No focus sessions this week yet — start focusing! 🚀</div>`;
    }
    return;
  }

  // ── My rank bar ───────────────────────────────────────────────────────────
  const myIdx = entries.findIndex(u => u.uid === currentUid);
  if (myIdx >= 0 && myRankBar) {
    const me = entries[myIdx];
    myRankBar.classList.add("visible");
    if (myRankVal) myRankVal.textContent = `#${myIdx + 1} of ${entries.length}`;
    if (myXpVal)   myXpVal.textContent   = `⭐ ${me.weeklyTimerXP || 0} XP`;

    if (myIdx < 3 && !popupShown) {
      popupShown = true;
      sessionStorage.setItem(POPUP_KEY, "true");
      setTimeout(() => showTopPopup(getLevel(me.weeklyTimerXP || 0), myIdx + 1), 800);
    }
  }

  // ── Podium (top 3) ────────────────────────────────────────────────────────
  if (podiumArea) {
    podiumArea.innerHTML = "";
    const podium = document.createElement("div");
    podium.className = "podium-wrap";

    const buildCol = (u, rank) => {
      if (!u) return null;
      const lvl = getLevel(u.weeklyTimerXP || 0);
      const col = document.createElement("div");
      col.className = "podium-col";
      col.innerHTML = `
        <div class="podium-avatar rank-${rank}">
          ${rank === 1 ? '<span class="podium-crown">👑</span>' : ""}
          ${(u.name || "?")[0].toUpperCase()}
        </div>
        <div class="podium-name">${escHtml(u.name || "—")}</div>
        <div class="podium-xp">⭐ ${u.weeklyTimerXP || 0} XP</div>
        <div class="podium-lvl">${lvl.icon} ${lvl.name}</div>
        <div class="podium-bar rank-${rank}">${rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</div>`;
      return col;
    };

    // Order: 2nd left, 1st centre, 3rd right
    const c2 = buildCol(entries[1], 2);
    const c1 = buildCol(entries[0], 1);
    const c3 = buildCol(entries[2], 3);
    if (c2) podium.appendChild(c2);
    if (c1) podium.appendChild(c1);
    if (c3) podium.appendChild(c3);
    podiumArea.appendChild(podium);
  }

  // ── Rank list 4–20 ────────────────────────────────────────────────────────
  if (rankList) {
    rankList.innerHTML = "";
    for (let i = 3; i < Math.min(entries.length, 20); i++) {
      const u   = entries[i];
      const rank = i + 1;
      const lvl = getLevel(u.weeklyTimerXP || 0);
      const isMe = u.uid === currentUid;

      const row = document.createElement("div");
      row.className = "rank-row";
      if (isMe) {
        row.style.border     = `1px solid ${lvl.color}`;
        row.style.background = lvl.bg;
        row.style.boxShadow  = `0 0 14px ${lvl.color}44`;
      }

      row.innerHTML = `
        <div class="rank-num">#${rank}</div>
        <div class="rank-avatar" style="color:${lvl.color};background:${lvl.bg};">
          ${(u.name || "?")[0].toUpperCase()}
        </div>
        <div class="rank-info">
          <div class="rank-name">${escHtml(u.name || "—")}${isMe ? `&nbsp;<span style="color:var(--cyan);font-size:11px;">(You)</span>` : ""}</div>
          <div class="rank-detail">⏱ ${formatTime(u.focusTime || 0)} focused this week</div>
        </div>
        <div class="rank-right">
          <div class="rank-xp">⭐ ${u.weeklyTimerXP || 0}</div>
          <div class="level-badge" style="background:${lvl.bg};color:${lvl.color};border:1px solid ${lvl.border};">
            ${lvl.icon} ${lvl.name}
          </div>
        </div>`;
      rankList.appendChild(row);
    }
  }
}

// ── Auth + live listener ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {

  if (!user) {
    if (loading) {
      loading.style.display = "block";
      loading.innerHTML = `<div style="padding:60px 20px;color:rgba(255,255,255,0.4);font-size:14px;">Please log in to view the leaderboard.</div>`;
    }
    return;
  }

  const currentUid = user.uid;

  /**
   * FIX: Read from "leaderboard" collection (uid-keyed) — NO double entries.
   *
   * weeklyTimerXP = timer XP earned this week only.
   * It resets in script.js auth section at start of new week (NOT on every focus).
   *
   * Old bug: reading "users" collection had 2 docs per user (displayName + uid).
   * Old bug: weeklyXP reset on every startBtn click if lastActiveWeek changed.
   * Both bugs are now fixed.
   */
  const q = query(
    collection(db, "leaderboard"),
    orderBy("weeklyTimerXP", "desc"),
    limit(50)
  );

  onSnapshot(q, snap => {
    const seen = new Set();
    const entries = snap.docs
      .map(d => ({
        uid:          d.id,
        name:         d.data().name          || "Anonymous",
        weeklyTimerXP:d.data().weeklyTimerXP || 0,
        focusTime:    d.data().focusTime      || 0,
      }))
      // Only show users with focus XP this week
      .filter(u => u.weeklyTimerXP > 0)
      // Deduplicate by uid (belt-and-braces)
      .filter(u => {
        if (seen.has(u.uid)) return false;
        seen.add(u.uid);
        return true;
      })
      .map((u, i) => ({ ...u, rank: i + 1 }));

    renderLeaderboard(entries, currentUid);
  }, err => {
    console.error("[Leaderboard]", err);
    if (loading) {
      loading.style.display = "block";
      loading.innerHTML = `<div style="padding:40px;color:rgba(255,79,106,0.7);font-size:14px;">Could not load leaderboard.</div>`;
    }
  });
});
