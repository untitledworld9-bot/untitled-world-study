import { initializeApp } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getFirestore,
  collection,
  onSnapshot
} from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "untitled-world-2e645"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const board = document.getElementById("board");

onSnapshot(collection(db,"users"), snap=>{

  let users=[];
  snap.forEach(doc=>{
    users.push(doc.data());
  });

  users.sort((a,b)=>(b.focusTime||0)-(a.focusTime||0));

  board.innerHTML="";

  users.slice(0,15).forEach((u,i)=>{

    const rank=i+1;

    let badge="";
    if(rank===1) badge="💎 Diamond";
    else if(rank===2) badge="🥇 Gold";
    else if(rank===3) badge="🥈 Silver";

    const totalMin=Math.floor(u.focusTime||0);
    const h=Math.floor(totalMin/60);
    const m=totalMin%60;

    board.innerHTML+=`
    <div style="
    padding:12px;
    margin-bottom:8px;
    background:rgba(255,255,255,0.05);
    border-radius:10px;
    ">
    <b>#${rank}</b> ${u.name} — ${h}h ${m}m 
    ${badge}
    </div>`;
  });

});
