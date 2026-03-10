import { db } from "./firebase.js"

import {
doc,
setDoc,
getDoc
}
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

const user = localStorage.getItem("userName")

const today = new Date().toISOString().slice(0,10)

let tasks=[]

// PWA CHECK

function isPWA(){
return window.matchMedia('(display-mode: standalone)').matches
|| window.navigator.standalone
}

if(!isPWA()){
alert("Checklist available only in app")
window.location.href="index.html"
}

// LOAD TASKS

async function load(){

const ref = doc(db,"checklists",user)

const snap = await getDoc(ref)

if(snap.exists() && snap.data().date===today){

tasks = snap.data().tasks

}else{

tasks=[]

}

render()

}

// RENDER UI

function render(){

const box=document.getElementById("taskList")

box.innerHTML=""

if(tasks.length===0){

box.innerHTML='<div class="empty">No tasks yet. Tap ＋ to add one!</div>'
return

}

tasks.forEach((t,i)=>{

box.innerHTML+=`

<div class="task ${t.done?"done":""}" style="animation-delay:${i*0.05}s">

<input type="checkbox"
${t.done?"checked":""}
onclick="toggleTask(${i})">

<span>${t.text}</span>

<button class="delete" onclick="deleteTask(${i})">🗑</button>

</div>

`

})

}

// ADD TASK

window.addTask=function(){

const text=prompt("Add new task")

if(!text) return

tasks.push({

text:text,
done:false

})

save()

}

// TOGGLE TASK

window.toggleTask=function(i){

tasks[i].done=!tasks[i].done

save()

}

// DELETE TASK

window.deleteTask=function(i){

tasks.splice(i,1)

save()

}

// SAVE FIRESTORE

async function save(){

await setDoc(

doc(db,"checklists",user),

{
date:today,
tasks
}

)

render()

}

load()