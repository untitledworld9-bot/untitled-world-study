console.log("INDEX JS RUNNING");

import { initializeApp, getApps } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { 
getFirestore,
collection,
onSnapshot
} from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


const firebaseConfig = {
 apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
 authDomain: "untitled-world-2e645.firebaseapp.com",
 projectId: "untitled-world-2e645",
 storageBucket: "untitled-world-2e645.firebasestorage.app",
 messagingSenderId: "990115586087",
 appId: "1:990115586087:web:963f68bd59dec5ef0c6e02"
};


// Firebase init (duplicate safe)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);


// Service worker register
if ("serviceWorker" in navigator) {
 navigator.serviceWorker.register("/firebase-messaging-sw.js")
 .then(reg => console.log("SW registered"))
 .catch(err => console.log("SW error", err));
}


// Current user
const currentUser = localStorage.getItem("userName");


// Notification listener
onSnapshot(collection(db,"notifications"), snap=>{

snap.docChanges().forEach(change=>{

if(change.type === "added"){

const n = change.doc.data();

if(n.user === currentUser || n.user === "all"){

navigator.serviceWorker.ready.then(reg=>{

reg.showNotification(n.title,{
body:n.body,
icon:"/icon-192.png",
badge:"/icon-192.png"
});

});

}

}

});

});

// ADMIN PROMOTION POPUP

onSnapshot(collection(db,"promotions"), snap=>{

snap.forEach(d=>{

const p = d.data();

if(!p.active) return;

const box = document.createElement("div");

box.style.position="fixed";
box.style.bottom="20px";
box.style.left="20px";
box.style.background="#111";
box.style.color="white";
box.style.padding="14px 18px";
box.style.borderRadius="12px";
box.style.zIndex="9999";
box.style.maxWidth="280px";
box.style.boxShadow="0 0 12px rgba(0,0,0,0.4)";

box.innerHTML=`
<b>${p.title}</b><br>
${p.message}
`;

document.body.appendChild(box);

setTimeout(()=>{
box.remove();
},6000);

});

});