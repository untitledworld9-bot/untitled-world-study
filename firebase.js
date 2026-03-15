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
 Timestamp
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
  apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain: "untitled-world-2e645.firebaseapp.com",
  projectId: "untitled-world-2e645",
  storageBucket: "untitled-world-2e645.firebasestorage.app",
  messagingSenderId: "990115586087",
  appId: "1:990115586087:web:963f68bd59dec5ef0c6e02",
  measurementId: "G-X2PB6L0C75"
};


// INIT FIREBASE
const app = getApps().length
 ? getApps()[0]
 : initializeApp(firebaseConfig);

const db = getFirestore(app);

const auth = getAuth(app);

const provider = new GoogleAuthProvider();


// PUSH NOTIFICATION
const messaging = getMessaging(app);

Notification.requestPermission().then(permission => {

 if(permission === "granted"){

  getToken(messaging,{
   vapidKey:"BDTkDBt3daAUhVvkAHvKuEJn1DI6MwZh5nYzMFu8ym7UQGKNaAbzCtH-RE6DiHCv3k22w_mfl7u8jY-KqN5aNpc"
  })
  .then(token => {

   if(token){
    console.log("FCM TOKEN:",token);
   }

  })
  .catch(err=>{
   console.log("Token error:",err);
  });

 }

});


// EXPORT
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
 Timestamp
};