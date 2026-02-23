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
  increment
} from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { 
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
  
const loginOverlay = document.getElementById("loginOverlay");

const savedName = localStorage.getItem("userName");

if(savedName){
  currentUser = savedName;
  loginOverlay.style.display="none";
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
    const createRoom = document.getElementById("createRoom");
    const joinRoom = document.getElementById("joinRoom");
    const roomInput = document.getElementById("roomInput");
    const progressLink = document.getElementById("progressLink");

if(progressLink){
  progressLink.addEventListener("click", ()=>{
     window.location.href="leaderboard.html";
  });
}

    // --- 1. LOGIN LOGIC ---
// 👇 YAHAN ADD GOOGLE LOGIN
const googleBtn = document.getElementById("googleLogin");

if(googleBtn){
 googleBtn.addEventListener("click", async ()=>{

  try{
   const result = await signInWithPopup(auth, provider);
   const user = result.user;

   currentUser = user.displayName;

   localStorage.setItem("userName", user.displayName);

   loginOverlay.style.display="none";

   await setDoc(doc(db,"users",currentUser),{
     name: currentUser,
     focusTime: 0,
     status:"Online",
     room: roomId
   });

  }catch(err){
    console.log(err);
  }

 });
}

onAuthStateChanged(auth, async user=>{
 if(user){

   currentUser = user.displayName;
   
   localStorage.setItem("userName", user.displayName);
   
   loginOverlay.style.display="none";

   const today = getTodayDate();
   const currentWeek = getWeekNumber();
   const userRef = doc(db,"users",currentUser);

   // 👇 OLD DATA CHECK
   const snap = await getDoc(userRef);
   
   if(snap.exists()){
 const data = snap.data();
  
  // DAILY RESET (optional)
 if(data.lastActiveDate !== today){
   await updateDoc(userRef,{
     focusTime:0,
     lastActiveDate:today
   });
 }

 // 👇 WEEKLY RESET (MAIN FEATURE)
 if(data.lastActiveWeek !== currentWeek){
   await updateDoc(userRef,{
     focusTime:0,
     lastActiveWeek:currentWeek
   });
 }
   }
    
  // 👇 ALWAYS UPDATE USER STATUS
   await setDoc(userRef,{
     name:currentUser,
     status:"Online",
     room:roomId,
     lastActiveDate: today
   },{merge:true});
 }
});
  
      // User exit detect
window.addEventListener("beforeunload", async () => {
  await updateDoc(doc(db,"users",currentUser),{
    status:"Offline"
  });
});
  
document.getElementById("createRoomBtn")
.addEventListener("click", async ()=>{

 const newRoom = Math.random().toString(36).substring(2,8);

 await updateDoc(doc(db,"users",currentUser),{
   room:newRoom
 });

 location.href=`/timer?room=${newRoom}`;
});

document.getElementById("joinRoomBtn")
.addEventListener("click", async ()=>{

 const id = prompt("Enter Room ID");
 if(!id) return;

 // ✅ ROOM EXIST CHECK
 const usersSnap = await getDocs(collection(db,"users"));
 let roomExists = false;

 usersSnap.forEach(docSnap=>{
   if(docSnap.data().room === id){
     roomExists = true;
   }
 });

 if(!roomExists){
   alert("Room not found ❌");
   return;
 }

 await updateDoc(doc(db,"users",currentUser),{
   room:id
 });

 location.href=`/timer?room=${id}`;
});

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

        timerInterval = setInterval(() => {
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
              
               if(seconds%60===0){
                 
              updateDoc(doc(db,"users",currentUser),{
 status:"Focusing 👋",
 focusTime: increment(1)
});
               }
            }
        }, 1000);
    }
});

    stopBtn.addEventListener("click", async () => {

    await updateDoc(doc(db,"users",currentUser),{
        status:"Online",
        focusTime: increment(Math.floor(seconds/60))
    });

    clearInterval(timerInterval);
    isRunning = false;

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

    function finishTimer() {
        clearInterval(timerInterval);
        alert("Session Complete!");
        stopBtn.click(); // Trigger reset
    }

    function updateDisplay() {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = seconds % 60;
        
        let timeStr = "";
        if (h > 0) {
            timeStr = `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
        } else {
            timeStr = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
        }
        display.innerText = timeStr;
    }

    // --- 4. PANEL & MENU LOGIC ---
    openPanelBtn.addEventListener("click", () => {
        socialSheet.classList.add("open");
        backdrop.style.display = "block";
    });

    closePanelBtn.addEventListener("click", () => {
        socialSheet.classList.remove("open");
        backdrop.style.display = "none";
    });
    
    backdrop.addEventListener("click", () => {
        socialSheet.classList.remove("open");
        backdrop.style.display = "none";
    });

    menuToggle.addEventListener("click", () => {
        navMenu.classList.toggle("active");
    });

    inviteBtn.addEventListener("click", () => {
        const url = `${location.origin}/timer?room=${roomId}`;
        navigator.clipboard.writeText(url).then(() => {
            alert("Link Copied!");
        });
    });
  
onSnapshot(collection(db,"users"), (snapshot) => {

    userList.innerHTML = "";

    snapshot.forEach(docSnap => {
    const u = docSnap.data();

        if(u.room === roomId && u.status !== "Offline"){
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
    let lastWaveTime = 0;

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
};

window.closeChat = ()=>{
 document.getElementById("chatBox").style.display="none";
};

onSnapshot(collection(db,"messages"), snap=>{
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
</div>`;
  }
 });
});

window.sendMsg = async ()=>{
 const txt=document.getElementById("chatInput").value;
 if(!txt) return;

 await addDoc(collection(db,"messages"),{
  from:currentUser,
  to:chattingWith,
  text:txt,
  room:roomId,
  time:Date.now()
 });
  
 document.getElementById("chatInput").value="";
};

let lastMsgTime = 0;

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

    setTimeout(()=>{
      box.style.display = "none";
    },4000);
  }
 });
});
  
// USER EXIT
window.addEventListener("beforeunload", () => {
 if(currentUser){
   updateDoc(doc(db,"users",currentUser),{
     status:"Offline"
   });
 }
});

window.logoutUser = async ()=>{
 await signOut(auth);
 window.location.href="login.html";
};

const statusBtn=document.getElementById("statusCard");

if(statusBtn){
 statusBtn.addEventListener("click", ()=>{
   window.location.href="leaderboard.html";
 });
}

});

  
