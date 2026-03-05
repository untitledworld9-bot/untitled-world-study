import { auth, onAuthStateChanged } from "./firebase.js";

onAuthStateChanged(auth,user=>{

if(!user || user.email!=="ayushgupt640@gmail.com"){
location.href="/"
}

});

import {
db,
collection,
onSnapshot,
addDoc
} from "./firebase.js";

const totalUsers=document.getElementById("totalUsers");
const onlineUsers=document.getElementById("onlineUsers");
const focusTime=document.getElementById("focusTime");
const rooms=document.getElementById("rooms");
const messagesCount=document.getElementById("messagesCount");

const userTable=document.getElementById("userTable");
const chatLogs=document.getElementById("chatLogs");

/* SECTION SWITCH */

window.showSection=(id)=>{

document.querySelectorAll(".section")
.forEach(s=>s.classList.remove("active"))

document.getElementById(id)
.classList.add("active")

}

/* USERS DATA */

onSnapshot(collection(db,"users"),snap=>{

let total=0
let online=0
let focus=0
let html=""

snap.forEach(doc=>{

const u=doc.data()

total++

if(u.status==="Online" || u.status==="Focusing 👋"){
online++
}

focus+=u.focusTime||0

html+=`

<tr>
<td>${u.name}</td>
<td>${u.status}</td>
<td>${u.focusTime||0}</td>
</tr>
`})

totalUsers.innerText=total
onlineUsers.innerText=online
focusTime.innerText=Math.floor(focus/60)+"h"

userTable.innerHTML=html

})

/* ROOMS */

onSnapshot(collection(db,"rooms"),snap=>{
rooms.innerText=snap.size
})

/* MESSAGES */

onSnapshot(collection(db,"messages"),snap=>{

messagesCount.innerText=snap.size

let html=""

snap.forEach(doc=>{

const m=doc.data()

html+=`

<div>
<b>${m.from}</b> → ${m.text}
</div>
`})

chatLogs.innerHTML=html

})

/* ANNOUNCEMENT */

window.sendAnnouncement=async()=>{

const text=document.getElementById("announceText").value

if(!text)return

await addDoc(collection(db,"announcements"),{
text:text,
active:true,
time:Date.now()
})

alert("Announcement Sent")

}