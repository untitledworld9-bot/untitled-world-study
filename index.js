/**
 * index.js — Untitled World (FINAL FIXED)
 *
 * FIXES
 * FIX-I   announcements composite index error
 * FIX-J   notifications query safe
 * FIX-K   bfcache restore
 * FIX-M   promotions body field fix
 * FIX-P   markSeen poisoning fix
 * FIX-Q   service worker reload loop removed
 * FIX-R   App Updates listener added
 */

import { db } from "./firebase.js";

import {
  collection,
  doc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";



/* ─────────────────────────────
   SESSION STORAGE
───────────────────────────── */

const SK = {
  ANNOUNCEMENTS:"uw_seen_announcements",
  NOTIFICATIONS:"uw_seen_notifications",
  PROMOTIONS:"uw_seen_promotions",
  LISTENERS_BOOT:"uw_listeners_booted"
};

const seen={
 announcements:new Set(JSON.parse(sessionStorage.getItem(SK.ANNOUNCEMENTS)||"[]")),
 notifications:new Set(JSON.parse(sessionStorage.getItem(SK.NOTIFICATIONS)||"[]")),
 promotions:new Set(JSON.parse(sessionStorage.getItem(SK.PROMOTIONS)||"[]"))
};

function markSeen(type,id){
 seen[type].add(id);
 try{
  sessionStorage.setItem(SK[type.toUpperCase()],JSON.stringify([...seen[type]]));
 }catch{}
}

const CURRENT_USER=localStorage.getItem("userName")||null;

const unsubs={
 announcements:null,
 notifications:null,
 promotions:null,
 updates:null
};



/* ─────────────────────────────
   HELPERS
───────────────────────────── */

function qs(s,r=document){try{return r.querySelector(s);}catch{return null}}

function safeAppend(p,c){if(p&&c)p.appendChild(c)}

function autoRemove(el,ms){setTimeout(()=>{if(el?.parentNode)el.remove()},ms)}

function showToast(html,duration=5000){

 const toast=document.createElement("div");

 toast.style.cssText=`
 position:fixed;
 bottom:24px;
 right:20px;
 background:#1e3a5f;
 color:#e2f0ff;
 padding:14px 20px;
 border-radius:14px;
 font-size:14px;
 font-weight:600;
 box-shadow:0 6px 20px rgba(0,0,0,0.5);
 z-index:99999;
 max-width:300px;
 border:1px solid rgba(0,242,254,0.25);
 line-height:1.5;
 `;

 toast.innerHTML=html;

 safeAppend(document.body,toast);
 autoRemove(toast,duration);
}

function isPWA(){
 return(
  window.matchMedia("(display-mode:standalone)").matches||
  window.navigator.standalone===true
 );
}



/* ─────────────────────────────
   SERVICE WORKER
───────────────────────────── */

function initServiceWorker(){

 if(!("serviceWorker"in navigator))return;

 navigator.serviceWorker.register("/firebase-messaging-sw.js");

 navigator.serviceWorker.register("/sw.js")
 .then(reg=>{

  const handleWaiting = w => {
  if (!w) return;

  // silently activate new service worker
  w.postMessage({ type: "SKIP_WAITING" });
};

 if(reg.waiting)handleWaiting(reg.waiting);

  reg.addEventListener("updatefound",()=>{
   const nw=reg.installing;
   if(!nw)return;

   nw.addEventListener("statechange",()=>{
    if(nw.state==="installed"&&navigator.serviceWorker.controller){
     handleWaiting(nw);
    }
   });

  });

 });

}



/* ─────────────────────────────
   ANNOUNCEMENTS
───────────────────────────── */

function initAnnouncements(){

 if(unsubs.announcements)return;

 const q=query(
  collection(db,"announcements"),
  orderBy("createdAt","desc"),
  limit(5)
 );

 unsubs.announcements=onSnapshot(q,snap=>{

  snap.docChanges().forEach(change=>{

   if(change.type!=="added")return;

   const id=change.doc.id;
   const data=change.doc.data();

   if(!data.active)return;
   if(seen.announcements.has(id))return;

   if(data.target==="pwa"&&!isPWA())return;

   renderAnnouncement(data.text);

   markSeen("announcements",id);

  });

 });

}

function renderAnnouncement(text){

 const el=document.createElement("div");
 el.className="admin-msg";
 el.textContent="📢 "+text;

 safeAppend(qs("#announcement-container")||document.body,el);

 autoRemove(el,5000);
}



/* ─────────────────────────────
   NOTIFICATIONS
───────────────────────────── */

function initNotifications(){

 if(unsubs.notifications)return;

 const start=Timestamp.now();

 const makeQuery=userVal=>query(
  collection(db,"notifications"),
  where("target","in",["all",userVal]),
  limit(10)
 );

 const handle=snap=>{

  snap.docChanges().forEach(change=>{

   if(change.type!=="added")return;

   const id=change.doc.id;
   const d=change.doc.data();

   if(d.createdAt&&d.createdAt.toMillis()<start.toMillis())return;
   if(seen.notifications.has(id))return;

   fireNotification(d.title,d.body);

   markSeen("notifications",id);
 updateDoc(doc(db,"notifications",id),{
 read:true
});

  });

 };

 const err=e=>console.warn(e);

 const unsubAll=onSnapshot(makeQuery("all"),handle,err);

 let unsubUser=()=>{};
 if(CURRENT_USER){
  unsubUser=onSnapshot(makeQuery(CURRENT_USER),handle,err);
 }

 unsubs.notifications=()=>{unsubAll();unsubUser()};

}

function fireNotification(title,body){

 if(Notification.permission!=="granted")return;

 const opts={
  body,
  icon:"/icon-192.png",
  badge:"/icon-192.png"
 };

 if(navigator.serviceWorker?.controller){
  navigator.serviceWorker.ready.then(r=>r.showNotification(title,opts));
 }else{
  new Notification(title,opts);
 }

}



/* ─────────────────────────────
   PROMOTIONS
───────────────────────────── */

function initPromotions(){

 if(unsubs.promotions)return;

 const q=query(
  collection(db,"promotions"),
  where("active","==",true),
  limit(5)
 );

 unsubs.promotions=onSnapshot(q,snap=>{

  snap.docChanges().forEach(change=>{

   if(change.type!=="added")return;

   const id=change.doc.id;
   const data=change.doc.data();

   if(seen.promotions.has(id))return;
   if(!data.title&&!data.body)return;

   renderPromotion(data);

   markSeen("promotions",id);

  });

 });

}

function renderPromotion(data){

 const popup=document.getElementById("promoPopup");
 if(!popup)return;

 const box=popup.querySelector(".promo-box");
 if(!box)return;

 box.innerHTML="";

 const title=document.createElement("h3");
 title.textContent=data.title||"";

 const body=document.createElement("p");
 body.textContent=data.body||"";

 box.appendChild(title);
 box.appendChild(body);

 popup.style.setProperty("display","flex","important");

 setTimeout(()=>{
  popup.style.setProperty("display","none","important");
 },(data.duration||8)*1000);

}



/* ─────────────────────────────
   APP UPDATES
───────────────────────────── */

let lastVersion=null;

function initAppUpdates(){

 if(unsubs.updates)return;

 const ref=doc(db,"appUpdates","latest");

 unsubs.updates=onSnapshot(ref,snap=>{

  if(!snap.exists())return;

  const data=snap.data();

  if(!data.active)return;

  // prevent repeat
  if(lastVersion===data.version)return;

  lastVersion=data.version;

  showUpdatePopup(data);

 });

}

function showUpdatePopup(data){

 const overlay=document.createElement("div");

 overlay.style.cssText=`
 position:fixed;
 inset:0;
 background:rgba(0,0,0,.8);
 display:flex;
 align-items:center;
 justify-content:center;
 z-index:99999
 `;

 overlay.innerHTML=`
 <div style="background:#111;padding:30px;border-radius:16px;max-width:350px;text-align:center">
  <h2>🚀 Update Available</h2>
  <p style="color:#888">${data.version||""}</p>
  <pre style="white-space:pre-wrap">${data.changelog||""}</pre>
  <button id="uwUpdateBtn"
   style="margin-top:15px;padding:10px 30px;border:none;border-radius:10px;background:#00e0ff;font-weight:700">
   Update App
  </button>
 </div>
 `;

 document.body.appendChild(overlay);

 document.getElementById("uwUpdateBtn").onclick=()=>location.reload(true);

}



/* ─────────────────────────────
   BOOT
───────────────────────────── */

function boot(){

 console.log("[UW] boot");

 initServiceWorker();

 if(sessionStorage.getItem(SK.LISTENERS_BOOT)==="1")return;

 sessionStorage.setItem(SK.LISTENERS_BOOT,"1");

 initAnnouncements();
 initNotifications();
 initPromotions();
 initAppUpdates();

}

document.addEventListener("DOMContentLoaded",boot);

window.addEventListener("pageshow",e=>{
 if(e.persisted){
  sessionStorage.removeItem(SK.LISTENERS_BOOT);
  boot();
 }
});

window.addEventListener("pagehide",()=>{

 if(typeof unsubs.announcements==="function")unsubs.announcements();
 if(typeof unsubs.notifications==="function")unsubs.notifications();
 if(typeof unsubs.promotions==="function")unsubs.promotions();
 if(typeof unsubs.updates==="function")unsubs.updates();

 sessionStorage.removeItem(SK.LISTENERS_BOOT);

});