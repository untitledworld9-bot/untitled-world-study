onAuthStateChanged(auth,user=>{
 if(!user) location.href="/timer";

 if(user.email !== "untitledworld9@gmail.com"){
   alert("Not admin");
   location.href="/timer";
 }

async function sendAnnouncement(){

 const text=document.getElementById("msg").value;

 if(!text) return alert("Write something");

 await addDoc(collection(db,"announcements"),{
   text:text,
   time:Date.now(),
   active:true
 });

 alert("Sent ✔");
}
});