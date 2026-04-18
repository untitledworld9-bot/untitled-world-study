/**
 * firebase.js — Study Grid Prep (FIXED)
 *
 * FIX: Removed Notification.requestPermission() + getToken() from module
 *      top level (lines 68-85 in original).
 *
 * WHY IT WAS BROKEN:
 *   • Called at import time, before any user gesture → browser blocks it silently
 *   • Even if granted, there was no currentUser yet → token saved under empty key
 *   • getToken() was essentially running uselessly every page load
 *
 * WHERE TO CALL IT INSTEAD:
 *   Inside onAuthStateChanged() in script.js, AFTER user is confirmed.
 *   See script.js for the correct placement.
 */

import { initializeApp, getApps } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  increment,
  deleteDoc,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  where,
  serverTimestamp,
  Timestamp,
  writeBatch
} from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getMessaging,
  getToken,
  onMessage
} from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";


const firebaseConfig = {
  apiKey:            "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain:        "untitled-world-2e645.firebaseapp.com",
  projectId:         "untitled-world-2e645",
  storageBucket:     "untitled-world-2e645.firebasestorage.app",
  messagingSenderId: "990115586087",
  appId:             "1:990115586087:web:963f68bd59dec5ef0c6e02",
  measurementId:     "G-X2PB6L0C75"
};

// Safe singleton init — works even if this module is evaluated twice
const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const db        = getFirestore(app);
const auth      = getAuth(app);
const provider  = new GoogleAuthProvider();
const messaging = getMessaging(app);

// ─── REMOVED: Notification.requestPermission() was here ──────────────────────
// It ran at import time before any user interaction — browser silently denies
// these requests, so FCM tokens were never obtained. Token acquisition is now
// handled inside onAuthStateChanged in script.js once the user is confirmed.
// ─────────────────────────────────────────────────────────────────────────────

export {
  db,
  auth,
  provider,
  messaging,
  getToken,
  onMessage,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  collection,
  addDoc,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  increment,
  deleteDoc,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  where,
  serverTimestamp,
  Timestamp,
  writeBatch
};
