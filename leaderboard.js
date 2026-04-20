/**
 * leaderboard.js — Untitled World Weekly (Focus) Leaderboard
 *
 * FIXED:
 *  - Reads from "leaderboard" collection (uid-keyed) → NO double entries
 *  - Sorts by timerXP (cumulative focus XP, NEVER resets)
 *  - Level system matches timerXP thresholds
 *  - Weekly section uses Firestore updatedAt, not weeklyXP reset
 *  - Auth check uses user.uid (not displayName) to match leaderboard docs
 */

import { db, auth, onAuthStateChanged } from "./firebase.js";

import {
  collection, doc, onSnapshot, getDoc,
  query, orderBy, limit, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Level system — based on timerXP (focus minutes / 2) ──────────────────────
// These mirror the LEVELS in the original file so UI stays the same
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysUntilReset() {
  const day = new Date().getDay();
  return day === 1 ? 7 : (8 - day) % 7;
}

function formatTime(totalMin) {
  const h = Math.floor((totalMin || 0) / 60);
  const m = (totalMin || 0) % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
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

// Note: timerXP is cumulative and never resets.
// The "reset" text refers to when we'll next update the weekly section filter.
if (resetTimer) {
  const d = daysUntilReset();
  resetTimer.textContent = `Updates in ${d} day${d === 1 ? "" : "s"}`;
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
        Keep focusing to climb higher 🚀
      </div>
      <button class="levelup-btn" onclick="this.closest('.levelup-overlay').remove()">
        Keep Going!
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Main render ───────────────────────────────────────────────────────────────
// entries: array of {uid, name, timerXP, focusTime, rank}
// currentUid: Firebase UID of logged-in user
function renderLeaderboard(entries, currentUid) {
  if (loading) loading.style.display = "none";

  if (!entries.length) {
    if (loading) {
      loading.style.display = "block";
      loading.innerHTML = `<div style="padding:40px;color:rgba(255,255,255,0.4);font-size:14px;">No focus sessions yet — be the first! 🚀</div>`;
    }
    return;
  }

  // ── My rank bar ───────────────────────────────────────────────────────────
  const myIdx = entries.findIndex(u => u.uid === currentUid);
  if (myIdx >= 0 && myRankBar) {
    const me = entries[myIdx];
    myRankBar.classList.add("visible");
    if (myRankVal) myRankVal.textContent = `#${myIdx + 1} of ${entries.length}`;
    if (myXpVal)   myXpVal.textContent   = `⏱ ${me.timerXP || 0} XP · ${formatTime(me.focusTime)}`;

    if (myIdx < 3 && !popupShown) {
      popupShown = true;
      sessionStorage.setItem(POPUP_KEY, "true");
      setTimeout(() => showTopPopup(getLevel(me.timerXP || 0), myIdx + 1), 800);
    }
  }

  // ── Podium (top 3) ────────────────────────────────────────────────────────
  if (podiumArea) {
    podiumArea.innerHTML = "";
    const podium = document.createElement("div");
    podium.className = "podium-wrap";

    const buildCol = (u, rank) => {
      if (!u) return null;
      const lvl = getLevel(u.timerXP || 0);
      const col = document.createElement("div");
      col.className = "podium-col";
      col.innerHTML = `
        <div class="podium-avatar rank-${rank}">
          ${rank === 1 ? '<span class="podium-crown">👑</span>' : ""}
          ${(u.name || "?")[0].toUpperCase()}
        </div>
        <div class="podium-name">${escHtml(u.name || "—")}</div>
        <div class="podium-xp">⏱ ${u.timerXP || 0} XP</div>
        <div class="podium-lvl">${lvl.icon} ${lvl.name}</div>
        <div class="podium-bar rank-${rank}">${rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</div>`;
      return col;
    };

    // Order: 2nd left, 1st centre, 3rd right
    [entries[1], entries[0], entries[2]].forEach((u, i) => {
      const col = buildCol(u, i === 0 ? 2 : i === 1 ? 1 : 3);
      if (col) podium.appendChild(col);
    });
    podiumArea.appendChild(podium);
  }

  // ── Rank list 4–20 ────────────────────────────────────────────────────────
  if (rankList) {
    rankList.innerHTML = "";
    for (let i = 3; i < Math.min(entries.length, 20); i++) {
      const u   = entries[i];
      const lvl = getLevel(u.timerXP || 0);
      const isMe = u.uid === currentUid;

      const row = document.createElement("div");
      row.className = "rank-row";
      if (isMe) {
        row.style.border     = `1px solid ${lvl.color}`;
        row.style.background = lvl.bg;
        row.style.boxShadow  = `0 0 14px ${lvl.color}44`;
      }

      row.innerHTML = `
        <div class="rank-num">#${i + 1}</div>
        <div class="rank-avatar" style="color:${lvl.color};background:${lvl.bg};">
          ${(u.name || "?")[0].toUpperCase()}
        </div>
        <div class="rank-info">
          <div class="rank-name">${escHtml(u.name || "—")}${isMe ? `&nbsp;<span style="color:var(--cyan);font-size:11px;">(You)</span>` : ""}</div>
          <div class="rank-detail">⏱ ${formatTime(u.focusTime || 0)} focused</div>
        </div>
        <div class="rank-right">
          <div class="rank-xp">⏱ ${u.timerXP || 0}</div>
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
   * FIX: Read from "leaderboard" collection, NOT "users".
   *   - leaderboard docs are keyed by Firebase UID → zero duplicates
   *   - timerXP field is cumulative and NEVER resets automatically
   *   - No weeklyXP reset logic needed here
   */
  const q = query(
    collection(db, "leaderboard"),
    orderBy("timerXP", "desc"),
    limit(50)
  );

  onSnapshot(q, snap => {
    // Build entry list — deduplicate by uid (belt-and-braces)
    const seen = new Set();
    const entries = snap.docs
      .map(d => ({
        uid:       d.id,
        name:      d.data().name      || "Anonymous",
        timerXP:   d.data().timerXP   || 0,
        focusTime: d.data().focusTime  || 0,
      }))
      // Only show users who have actually focused
      .filter(u => u.timerXP > 0 || u.focusTime > 0)
      // Deduplicate by uid
      .filter(u => { if (seen.has(u.uid)) return false; seen.add(u.uid); return true; })
      // Already sorted by timerXP from Firestore
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

// ── Escape helper ─────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}
