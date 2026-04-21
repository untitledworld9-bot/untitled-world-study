/**
 * uw-core.js — Study Grid Prep
 *
 * Single source of truth for XP, Streak, Firebase sync.
 * Both todo.html and playlist.html import this.
 *
 * Exposes window.UW so non-module inline scripts can call everything.
 * Sets window.db and window.auth so legacy checks still work.
 *
 * UPDATED: _syncLeaderboard now reads timerXP from existing leaderboard
 *          doc so level is computed from combined (playlist+todo+timer) XP.
 */

import {
  db,
  auth,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "./firebase.js";

/* ─────────────────────────────
   STORAGE KEYS (shared across all pages)
───────────────────────────── */
const XP_KEY          = "uw_xp";
const STREAK_KEY      = "uw_streak";
const STREAK_DATE_KEY = "uw_last_streak";
const BONUS_KEY       = "uw_todo_daily_bonus";

/* ─────────────────────────────
   INTERNAL STATE
───────────────────────────── */
let _authUser        = null;
let _ready           = false;
let _readyCallbacks  = [];

/* ─────────────────────────────
   AUTH STATE
───────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  _authUser = user;
  window.db   = db;
  window.auth = auth;

  if (user) {
    await loadUserData();
  }

  _ready = true;
  _readyCallbacks.forEach(cb => { try { cb(user); } catch(e) {} });
  _readyCallbacks = [];

  window.dispatchEvent(new CustomEvent("uw_auth_ready", { detail: { user } }));
});

/* ─────────────────────────────
   onReady
───────────────────────────── */
function onReady(cb) {
  if (_ready) { try { cb(_authUser); } catch(e) {} }
  else _readyCallbacks.push(cb);
}

/* ─────────────────────────────
   XP
───────────────────────────── */
function getXP() {
  return Math.max(0, parseInt(localStorage.getItem(XP_KEY) || "0", 10));
}

async function setXPAbsolute(v) {
  v = Math.max(0, v);
  localStorage.setItem(XP_KEY, String(v));
  window.dispatchEvent(new CustomEvent("uw_xp_changed", { detail: { xp: v } }));
  await _saveUser({ xp: v });
  await _syncLeaderboard();
  return v;
}

async function updateXP(amount) {
  return setXPAbsolute(getXP() + amount);
}

/* ─────────────────────────────
   STREAK
───────────────────────────── */
function getStreak() {
  return Math.max(0, parseInt(localStorage.getItem(STREAK_KEY) || "0", 10));
}

async function updateStreak() {
  const today     = new Date().toDateString();
  const last      = localStorage.getItem(STREAK_DATE_KEY) || "";

  if (last === today) return getStreak();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  let count = getStreak();
  if (last === yesterdayStr) {
    count++;
  } else {
    count = 1;
  }

  localStorage.setItem(STREAK_KEY, String(count));
  localStorage.setItem(STREAK_DATE_KEY, today);

  window.dispatchEvent(new CustomEvent("uw_streak_changed", { detail: { streak: count } }));
  await _saveUser({ streak: count, lastStreakDate: today });
  await _syncLeaderboard();
  return count;
}

/* ─────────────────────────────
   LEVEL SYSTEM
───────────────────────────── */
const LEVEL_THRESHOLDS = [0, 100, 250, 500, 800, 1200, 1700, 2300];

function getLevel(xp) {
  xp = (xp !== undefined) ? xp : getXP();
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function getLevelProgress(xp) {
  xp = (xp !== undefined) ? xp : getXP();
  const level = getLevel(xp);
  if (level >= 8) return 100;
  const from = LEVEL_THRESHOLDS[level - 1];
  const to   = LEVEL_THRESHOLDS[level];
  return Math.round(((xp - from) / (to - from)) * 100);
}

/* ─────────────────────────────
   BADGE SYSTEM
───────────────────────────── */
function getBadge(xp) {
  xp = (xp !== undefined) ? xp : getXP();
  if (xp >= 500) return "🏆 Untitled Champion";
  if (xp >= 300) return "⚡ Study Master";
  if (xp >= 150) return "🔥 Focused Learner";
  if (xp >= 50)  return "⭐ Rising Learner";
  return "🏅 Beginner";
}

/* ─────────────────────────────
   LOAD USER DATA
───────────────────────────── */
async function loadUserData() {
  if (!_authUser) return null;
  try {
    const snap = await getDoc(doc(db, "users", _authUser.uid));
    if (snap.exists()) {
      const d = snap.data();
      if (d.xp !== undefined) {
        localStorage.setItem(XP_KEY, String(Math.max(0, d.xp)));
        window.dispatchEvent(new CustomEvent("uw_xp_changed", { detail: { xp: d.xp } }));
      }
      if (d.streak !== undefined)   localStorage.setItem(STREAK_KEY, String(d.streak));
      if (d.lastStreakDate)          localStorage.setItem(STREAK_DATE_KEY, d.lastStreakDate);
      return d;
    }
  } catch(e) { console.warn("[UW Core] loadUserData failed:", e); }
  return null;
}

/* ─────────────────────────────
   SAVE USER DATA (partial merge)
───────────────────────────── */
async function saveUserData(partial) {
  await _saveUser(partial);
}

async function _saveUser(partial) {
  if (!_authUser) return;
  try {
    await setDoc(doc(db, "users", _authUser.uid), partial, { merge: true });
  } catch(e) { console.warn("[UW Core] saveUser failed:", e); }
}

/* ─────────────────────────────
   LEADERBOARD SYNC
   Reads existing timerXP from leaderboard so level reflects
   combined (playlist/todo + timer) XP.
   Uses merge:true so script.js writes to timerXP/focusTime are preserved.
───────────────────────────── */
async function _syncLeaderboard() {
  if (!_authUser) return;
  const playlistXP = getXP();
  const streak     = getStreak();
  const name       = _authUser.displayName || _authUser.email || "Anonymous";

  try {
    // Read existing timerXP to compute combined level
    let timerXP = 0;
    try {
      const lbSnap = await getDoc(doc(db, "leaderboard", _authUser.uid));
      if (lbSnap.exists()) timerXP = lbSnap.data().timerXP || 0;
    } catch(e) {}

    const totalXP = playlistXP + timerXP;
    const level   = getLevel(totalXP);

    // Write playlist/todo XP; merge:true preserves timerXP + focusTime written by script.js
    await setDoc(doc(db, "leaderboard", _authUser.uid), {
      name,
      xp:        playlistXP,   // playlist + todo XP only
      streak,
      level,                   // level from combined total
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch(e) { console.warn("[UW Core] leaderboard sync failed:", e); }
}

async function updateLeaderboard() {
  return _syncLeaderboard();
}

/* ─────────────────────────────
   SAVE TASKS + PLAYLIST to Firebase
───────────────────────────── */
async function syncData(payload) {
  if (!_authUser) return;
  try {
    const base = {
      xp:             getXP(),
      streak:         getStreak(),
      lastStreakDate: localStorage.getItem(STREAK_DATE_KEY) || ""
    };
    await setDoc(
      doc(db, "users", _authUser.uid),
      { ...base, ...payload },
      { merge: true }
    );
    await _syncLeaderboard();
  } catch(e) { console.warn("[UW Core] syncData failed:", e); }
}

/* ─────────────────────────────
   EXPOSE TO WINDOW
───────────────────────────── */
window.UW = {
  onReady,
  getXP,
  setXPAbsolute,
  updateXP,
  getStreak,
  updateStreak,
  getLevel,
  getLevelProgress,
  getBadge,
  loadUserData,
  saveUserData,
  syncData,
  updateLeaderboard,
  LEVEL_THRESHOLDS
};

console.log("[UW Core] loaded");
