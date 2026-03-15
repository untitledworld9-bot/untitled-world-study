import { initializeApp } from 
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
 getDocs
}from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { 
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ✅ FIX 1: Moved import to top level (was inside DOMContentLoaded — caused SyntaxError)
import { messaging, getToken, onMessage } from "./firebase.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain: "untitled-world-2e645.firebaseapp.com",
  projectId: "untitled-world-2e645",
  storageBucket: "untitled-world-2e645.firebasestorage.app",
  messagingSenderId: "990115586087",
  appId: "1:990115586087:web:963f68bd59dec5ef0c6e02",
  measurementId: "G-X2PB6L0C75"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

if ("serviceWorker" in navigator) {
 navigator.serviceWorker.register("/firebase-messaging-sw.js")
 .then(reg => console.log("SW registered"))
 .catch(err => console.log("SW error", err));
}
// ROOM SYSTEM
const params = new URLSearchParams(location.search);
const roomId = params.get("room") || "default";
document.addEventListener("DOMContentLoaded", () => {
  
    // --- VARIABLES ---
    let currentUser = "";
    let timerInterval;
    let seconds = 0;
    let isRunning = false;
    let mode = "stopwatch"; // 'stopwatch' or 'countdown'
    let initialSeconds = 0;

function updateDisplay(){

 const mins = Math.floor(seconds/60);
 const secs = seconds%60;

 display.innerText =
  `${mins<10?"0"+mins:mins}:${secs<10?"0"+secs:secs}`;
}

const loginOverlay = document.getElementById("loginOverlay");

if(loginOverlay) loginOverlay.style.display="none";

const savedName = localStorage.getItem("userName");

if(savedName){
  currentUser = savedName;
  if(loginOverlay) loginOverlay.style.display="none";
}
  
function getTodayDate(){
  const d = new Date();
  return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
}

function getWeekNumber(){
 const d=new Date();
 d.setHours(0,0,0,0);
 d.setDate(d.getDate()+4-(d.getDay()||7));
 const yearStart=new Date(d.getFullYear(),0,1);
 const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
 return d.getFullYear()+"-W"+week;
}

    // --- DOM ELEMENTS ---
    const usernameInput = document.getElementById("username");
    const loginBtn = document.getElementById("loginBtn");
    
    const display = document.getElementById("display");
    const ring = document.getElementById("ring");
    const modeLabel = document.getElementById("modeLabel");
    
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const presetBtns = [];
    
    const menuToggle = document.getElementById("menuToggle");
    const navMenu = document.getElementById("navMenu");
    
    const openPanelBtn = document.getElementById("openPanelBtn");
    const closePanelBtn = document.getElementById("closePanelBtn");
    const socialSheet = document.getElementById("socialSheet");
    const backdrop = document.getElementById("backdrop");
    const userList = document.getElementById("userList");
    const inviteBtn = document.getElementById("inviteBtn");

    const progressLink = document.getElementById("progressLink");

if(progressLink){
  progressLink.addEventListener("click", ()=>{
     window.location.href="leaderboard.html";
  });
}

onAuthStateChanged(auth, async user=>{
 if(!user){
   loginOverlay.style.display="flex";
   return;
 }

 currentUser = user.displayName;
 localStorage.setItem("userName", currentUser);
 loginOverlay.style.display="none";

 const today = getTodayDate();
 const currentWeek = getWeekNumber();
 const userRef = doc(db,"users", currentUser);

 const snap = await getDoc(userRef);

 // ✅ DAILY RESET only if document exists
 if(snap.exists()){
   const data = snap.data();

   if(data.lastActiveDate !== today){
     await updateDoc(userRef,{
       focusTime:0,
       lastActiveDate:today
     });
   }
 }

 // ✅ ALWAYS create/update user (important)
 await setDoc(userRef,{
   name:currentUser,
   email:user.email,
   status:"Online",
   room:roomId,
   lastActiveDate:today,
   lastActiveWeek:currentWeek
 },{merge:true});
});
  
// ===== CREATE ROOM =====
const createModal = document.getElementById("createModal");
const createBtn = document.getElementById("createRoomBtn");
const confirmCreate = document.getElementById("confirmCreate");

if(createBtn){
 createBtn.onclick = () => {
   createModal.style.display = "flex";
 };
}

if(confirmCreate){
 confirmCreate.onclick = async () => {

   const name = document.getElementById("roomName").value.trim();

   if(!name){
     alert("Enter room name");
     return;
   }

   const newRoomId = name + "_" + Math.random().toString(36).substring(2,5);

   await setDoc(doc(db,"rooms",newRoomId),{
     name:name,
     createdBy:currentUser,
     createdAt:Date.now()
   });

   await updateDoc(doc(db,"users",currentUser),{
     room:newRoomId
   });

   location.href=`/timer?room=${newRoomId}`;
 };
}


// ===== JOIN ROOM =====
const joinModal = document.getElementById("joinModal");
const joinBtn = document.getElementById("joinRoomBtn");
const confirmJoin = document.getElementById("confirmJoin");

if(joinBtn){
 joinBtn.onclick = () => {
   joinModal.style.display = "flex";
 };
}

if(confirmJoin){
 confirmJoin.onclick = async () => {

   const id = document.getElementById("joinRoomInput").value.trim();

   if(!id){
     alert("Enter Room ID");
     return;
   }

   const snap = await getDoc(doc(db,"rooms",id));

   if(!snap.exists()){
     alert("Room not found ❌");
     return;
   }

   await updateDoc(doc(db,"users",currentUser),{
     room:id
   });

   location.href=`/timer?room=${id}`;
 };
}

    // --- 2. TIMER PRESET LOGIC ---
    presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            if (isRunning) return; // Can't change while running

            // Visual Feedback
            presetBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Set Logic
            mode = "countdown";
            const mins = parseInt(btn.getAttribute("data-time"));
            seconds = mins * 60;
            initialSeconds = seconds;
            
            updateDisplay();
            modeLabel.innerText = "Countdown Mode";
        });
    });

    // --- 3. START / STOP LOGIC ---
    startBtn.addEventListener("click", async () => {

    if(!currentUser){
        alert("Login first");
        return;
    }

    const currentWeek=getWeekNumber();
const userRef=doc(db,"users",currentUser);
const snap=await getDoc(userRef);

if(snap.exists()){
 const data=snap.data();

 if(data.lastActiveWeek!==currentWeek){
  await updateDoc(userRef,{
   weeklyXP:0,
   focusTime:0,
   lastActiveWeek:currentWeek
  });
 }
}

    // Update status only
    await updateDoc(doc(db,"users",currentUser),{
        status:"Focusing 👋"
    });

    if (!isRunning) {
        isRunning = true;
        startBtn.style.display = "none";
        stopBtn.style.display = "block";
        ring.classList.add("active");

        presetBtns.forEach(b => b.style.pointerEvents = "none");

        timerInterval = setInterval(async () => {
            if (mode === "countdown") {
                if (seconds > 0) {
                    seconds--;
                    updateDisplay();
                } else {
                    finishTimer();
                }
            } else {
                seconds++;
                updateDisplay();
              
               if(seconds % 60 === 0 && isRunning){

 // Daily focus time
 await updateDoc(doc(db,"users",currentUser),{
  status:"Focusing 👋",
  focusTime: increment(1)
 });

}

// ⭐ Weekly XP (2 min = 1 XP)
if(seconds % 120 === 0 && isRunning){

 await updateDoc(doc(db,"users",currentUser),{
  weeklyXP: increment(1)
 });

}
            }
        }, 1000);
    }
});

stopBtn.addEventListener("click", async () => {

    clearInterval(timerInterval);
    isRunning = false;

    // ✅ SAVE FINAL TIME BEFORE RESET
    const mins = Math.floor(seconds/60);

    if(mins > 0){
      await updateDoc(doc(db,"users",currentUser),{
        status:"Online",
        focusTime: increment(mins)
      });
    }

    startBtn.style.display = "block";
    stopBtn.style.display = "none";
    ring.classList.remove("active");

    presetBtns.forEach(b => b.style.pointerEvents = "auto");

    if (mode === "countdown") {
        seconds = initialSeconds;
    } else {
        seconds = 0;
        display.innerText = "00:00";
    }

    updateDisplay();
});

    // --- 4. PANEL & MENU LOGIC ---
    if(openPanelBtn && socialSheet && backdrop){
 openPanelBtn.addEventListener("click", () => {
  socialSheet.classList.add("open");
  backdrop.style.display = "block";
 });
}

if(closePanelBtn && socialSheet && backdrop){
 closePanelBtn.addEventListener("click", () => {
  socialSheet.classList.remove("open");
  backdrop.style.display = "none";
 });
}

if(backdrop && socialSheet){
 backdrop.addEventListener("click", () => {
  socialSheet.classList.remove("open");
  backdrop.style.display = "none";
 });
}

if(menuToggle && navMenu){
 menuToggle.addEventListener("click", () => {
  navMenu.classList.toggle("active");
 });
}

// ✅ FIX 2: Moved inviteWhatsapp & copyInvite onclick assignments INSIDE the click listener
//           so inviteMessage, inviteWhatsapp, copyInvite are all in the same scope
if(inviteBtn){
 inviteBtn.addEventListener("click", () => {
  const inviteWhatsapp = document.getElementById("inviteWhatsapp");
  const copyInvite = document.getElementById("copyInvite");

  const link = `${location.origin}/timer?room=${roomId}`;

  const inviteMessage =
`📚 Focus Study Room

Let's stay productive together 🚀

Join here:
${link}`;

  // WhatsApp open
  if(inviteWhatsapp){
   inviteWhatsapp.onclick = ()=>{

   const url = "https://wa.me/?text=" + encodeURIComponent(inviteMessage);

   window.open(url,"_blank");

   };
  }

  // Copy message
  if(copyInvite){
   copyInvite.onclick = async ()=>{

   await navigator.clipboard.writeText(inviteMessage);

   alert("Invite message copied ✅");

   };
  }

 });
}

let lastWaveTime = 0;
  
onSnapshot(collection(db,"users"), (snapshot) => {

    userList.innerHTML = "";

    snapshot.forEach(docSnap => {
    const u = docSnap.data();

        if(u.room === roomId && (u.status === "Online" || u.status === "Focusing 👋")){
    userList.innerHTML += `
    <div class="member-card">
        <div style="font-size:24px;margin-right:10px;">👤</div>

        <div style="flex:1">
            <div style="font-weight:bold;">${u.name}</div>
            <div style="font-size:12px;">
 <span class="status-dot ${u.status==='Online'?'online':'offline'}"></span>
 ${u.status}
</div>
        </div>

        ${u.name !== currentUser ? 
`
<button onclick="wave('${u.name}')"
style="background:#00f2fe;border:none;
padding:6px 12px;border-radius:20px;
cursor:pointer;font-size:12px;">
👋 Wave
</button>

<button onclick="openChat('${u.name}')"
style="background:#00ff88;border:none;
padding:6px 12px;border-radius:20px;
cursor:pointer;font-size:12px;margin-left:5px;">
💬 Msg
</button>
`
: ""}
    </div>
    `;
        }
    
if(
 u.waveFrom &&
 u.name === currentUser &&
 u.waveTime > lastWaveTime
){
 lastWaveTime = u.waveTime;

 const pop=document.createElement("div");
 pop.className="wave-popup";
 pop.innerText=`👋 ${u.waveFrom} waved at you`;

 document.body.appendChild(pop);

 setTimeout(()=>{
   pop.remove();
   
 updateDoc(doc(db,"users",currentUser),{
  waveFrom:"",
  waveTime:0
 });
},5000);
}
    });

});

onSnapshot(collection(db,"users"), snap => {

    const board = document.getElementById("leaderboard");
    if(!board) return;

    let users = [];

    snap.forEach(docSnap=>{
    users.push(docSnap.data());
});

    users.sort((a,b)=>(b.focusTime||0)-(a.focusTime||0));

    board.innerHTML = "";

    users.slice(0,10).forEach((u, index)=>{

    const totalMin = Math.floor(u.focusTime||0);
    const h = Math.floor(totalMin/60);
    const m = totalMin%60;

    const badge =
 index===0?'💎':
 index===1?'🥇':
 index===2?'🥈':'';

    board.innerHTML += `
    <div>${badge} ${u.name} — ${h}h ${m}m</div>`;
});

});
window.wave = async (name)=>{
 await updateDoc(doc(db,"users",name),{
   waveFrom: currentUser,
   waveTime: Date.now()
 });
};

let chattingWith="";

window.openChat = (name)=>{
 chattingWith=name;
 document.getElementById("chatBox").style.display="block";

 document.getElementById("chatMessages").innerHTML =
 "<div style='text-align:center;opacity:.6'>Loading chat...</div>";
};

window.closeChat = ()=>{
 document.getElementById("chatBox").style.display="none";
};

onSnapshot(query(collection(db,"messages"), where("room", "==", roomId), orderBy("time")), snap=>{
 const chatArea=document.getElementById("chatMessages");
 if(!chatArea) return;

 chatArea.innerHTML="";

 snap.forEach(d=>{
  const m=d.data();

  if(
 m.room===roomId &&
 (m.from===currentUser && m.to===chattingWith ||
  m.from===chattingWith && m.to===currentUser)
){

 chatArea.innerHTML += `
<div class="${m.from===currentUser?'msg-me':'msg-other'}">
 <b>${m.from}</b>
 ${m.text}
 <span style="font-size:10px;margin-left:6px;">
  ${m.status==="seen"?"✔✔":
    m.status==="delivered"?"✔✔":
    "✔"}
 </span>
</div>`;

 // ✅ DELIVERED UPDATE
 if(m.to===currentUser && m.status==="sent"){
  updateDoc(doc(db,"messages",d.id),{
   status:"delivered"
  });
 }

 // ✅ SEEN UPDATE
 if(m.to===currentUser && m.from===chattingWith){
  updateDoc(doc(db,"messages",d.id),{
   status:"seen"
  });
 }

}
});   
});   

const inputBox=document.getElementById("chatInput");

if(inputBox){
 inputBox.addEventListener("input", async ()=>{
  if(!chattingWith) return;

  await setDoc(doc(db,"typing",currentUser+"_"+chattingWith),{
   from:currentUser,
   to:chattingWith,
   typing:true,
   time:Date.now()
  });
 });
}

window.sendMsg = async ()=>{
 const txt=document.getElementById("chatInput").value;
 if(!txt) return;

await addDoc(collection(db,"messages"),{
 from:currentUser,
 to:chattingWith,
 text:txt,
 room:roomId,
 time:Date.now(),
 status:"sent"   // 👈 ADD THIS
});
 document.getElementById("chatInput").value="";
};

let lastMsgTime = Date.now(); // Now it actually matches your comment!


onSnapshot(collection(db,"messages"), snap=>{
    snap.forEach(d=>{
        const m=d.data();

        if(
            m.room===roomId &&
            m.to===currentUser &&
            m.from!==currentUser &&
            m.time > lastMsgTime
        ){
            lastMsgTime = m.time;

            const box = document.getElementById("chatNotify");
            const txt = document.getElementById("notifyText");

            if(!box || !txt) return;

            txt.innerText = `${m.from}: ${m.text}`;
            box.style.display = "block";
            box.classList.add("active"); // CSS blink animation trigger karne ke liye

            setTimeout(()=>{
                box.style.display = "none";
                box.classList.remove("active");
            },4000);
        }
    });
});

onSnapshot(collection(db,"typing"), snap=>{
 snap.forEach(d=>{
  const t=d.data();

  if(t.to===currentUser && t.from===chattingWith){

   let el=document.getElementById("typingIndicator");

   if(!el){
    el=document.createElement("div");
    el.id="typingIndicator";
    el.style.opacity=".7";
    el.style.fontSize="12px";
    el.innerText=t.from+" typing...";
    document.getElementById("chatMessages").appendChild(el);
   }

   setTimeout(()=>{
    if(el) el.remove();
   },2000);
  }
 });
});
  
// USER EXIT
window.addEventListener("visibilitychange", async ()=>{
 if(!currentUser) return;

 if(document.visibilityState==="hidden"){
  await updateDoc(doc(db,"users",currentUser),{
   status:"Offline"
  });
 } else {
  await updateDoc(doc(db,"users",currentUser),{
   status:"Online"
  });
 }
});

window.addEventListener("beforeunload", async ()=>{
 if(currentUser){
  await updateDoc(doc(db,"users",currentUser),{
   status:"Offline"
  });
 }
});

window.logoutUser = async ()=>{
 await signOut(auth);

 localStorage.removeItem("userName");  // 👈 ADD THIS
 location.reload();                    // 👈 CHANGE THIS
};

const statusBtn=document.getElementById("statusCard");

if(statusBtn){
 statusBtn.addEventListener("click", ()=>{
   window.location.href="leaderboard.html";
 });
}

onSnapshot(collection(db,"announcements"), snap=>{
 snap.forEach(d=>{

  const a=d.data();
  if(!a.active) return;

  const box=document.createElement("div");
  box.className="admin-msg";
  box.innerText="📢 "+a.text;

  document.body.appendChild(box);

  setTimeout(()=>box.remove(),5000);

 });
});

onSnapshot(collection(db,"messages"), snap=>{
 snap.forEach(async d=>{
  const m=d.data();

  if(Date.now()-m.time > 172800000){
   await deleteDoc(doc(db,"messages",d.id));
  }
 });
});

/* ADMIN PUSH NOTIFICATION LISTENER */

onSnapshot(collection(db,"notifications"), snap=>{

snap.docChanges().forEach(change=>{

if(change.type === "added"){

const n = change.doc.data()

if(n.user === currentUser || n.user === "all"){

navigator.serviceWorker.ready.then(reg=>{

reg.showNotification(n.title,{
body:n.body,
icon:"/icon-192.png",
badge:"/icon-192.png"
})

})

}

}

})

});

Notification.requestPermission().then(async permission => {

 if(permission === "granted"){

  const token = await getToken(messaging,{
   vapidKey:"BDTkDBt3daAUhVvkAHvKuEJn1DI6MwZh5nYzMFu8ym7UQGKNaAbzCtH-RE6DiHCv3k22w_mfl7u8jY-KqN5aNpc"
  });

  console.log("FCM TOKEN:",token);

  await updateDoc(doc(db,"users",currentUser),{
   fcmToken: token
  });

 }

});

}); // ✅ FIX 3: Closing brace for DOMContentLoaded — was missing
