onAuthStateChanged(auth,user=>{
 if(!user) location.href="/timer";

 if(user.email !== "untitledworld9@gmail.com"){
   alert("Not admin");
   location.href="/timer";
 }
});