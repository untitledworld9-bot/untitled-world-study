import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
 apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
 authDomain: "untitled-world-2e645.firebaseapp.com",
 projectId: "untitled-world-2e645"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const board = document.getElementById("board");

if(!board){
 console.log("Board element missing");
}

// 🔥 IMPORTANT — WAIT FOR AUTH
onAuthStateChanged(auth, async user => {

 if(!user){
   board.innerHTML="<div style='text-align:center;padding:20px;'>Login required</div>";
   return;
 }

 // ⭐ WEEKLY RESET CHECK
 const { doc, getDoc, updateDoc } =
 await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

 const getWeekNumber=()=>{
  const d=new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const yearStart=new Date(d.getFullYear(),0,1);
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
 };

 const ref=doc(db,"users",user.displayName);
 const snap=await getDoc(ref);

 if(snap.exists()){
  const data=snap.data();
  const week=getWeekNumber();

  if(data.lastActiveWeek!==week){
   await updateDoc(ref,{
    focusTime:0,
    lastActiveWeek:week
   });
  }
 }

 // 🔥 SNAPSHOT AFTER AUTH
 onSnapshot(collection(db,"users"), snap => {

  let users = [];

  snap.forEach(docSnap => {
    users.push(docSnap.data());
  });

  // Sort by focusTime (Descending order)
  users.sort((a,b)=>(b.weeklyXP||0)-(a.weeklyXP||0));

  board.innerHTML = ""; // Clear board

  // Get Top 15
  const top15 = users.slice(0, 15);

  if (top15.length === 0) {
      board.innerHTML = "<div style='text-align:center;'>No users found yet.</div>";
      return;
  }

  // Helper Function for Time Formatting
  const formatTime=(totalMin)=>{
 const t=totalMin||0;
 const h=Math.floor(t/60);
 const m=t%60;
 return `${h}h ${m}m`;
};

  // =========================================================
  // 1. GENERATE TOP 3 PODIUM HTML
  // =========================================================
  
  let podiumHTML = `<div class="edtech-podium-card">`;
  
  const u1 = top15[0];
  const u2 = top15[1];
  const u3 = top15[2];

  // 🥈 Rank 2 (Left Side)
  if (u2) {
      podiumHTML += `
      <div class="podium-item podium-2">
          <div class="podium-rank-badge">2</div>
          <div class="podium-name">${u2.name}</div>
          <div class="podium-score">🥇 Gold</div>
          <div class="podium-score">⭐ ${u2.weeklyXP || 0}</div>
      </div>`;
  }

  // 💎 Rank 1 (Center - Sabse Bada)
  if (u1) {
      podiumHTML += `
      <div class="podium-item podium-1">
          <div class="podium-rank-badge">1</div>
          <div class="podium-name" style="font-size:16px;">${u1.name}</div>
          <div class="podium-score">💎 Diamond</div>
          <div class="podium-score">⭐ ${u1.weeklyXP || 0}</div>
      </div>`;
  }

  // 🥉 Rank 3 (Right Side)
  if (u3) {
      podiumHTML += `
      <div class="podium-item podium-3">
          <div class="podium-rank-badge">3</div>
          <div class="podium-name">${u3.name}</div>
          <div class="podium-score">🥈 Silver</div>
          <div class="podium-score">⭐ ${u3.weeklyXP || 0}</div>
      </div>`;
  }

  podiumHTML += `</div>`; // Close podium card

  // Add podium to board if at least 1 user exists
  if (u1) {
      board.innerHTML += podiumHTML;
  }


  // =========================================================
  // 2. GENERATE RANK 4 TO 15 (Simple EdTech List)
  // =========================================================
  
  for (let i = 3; i < top15.length; i++) {
      const u = top15[i];
      const rank = i + 1;

      board.innerHTML += `
      <div class="rank-card edtech-list-card">
          <span class="rank-badge" style="font-size: 16px; width: 30px;">#${rank}</span>
          <span style="flex-grow: 1; padding-left: 15px; font-weight: 600;">${u.name}</span>
          <span style="opacity:0.9;font-weight:bold;">
⭐ ${u.weeklyXP || 0}
</span>
      </div>`;
  }

 });

});
