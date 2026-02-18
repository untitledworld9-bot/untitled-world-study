import { initializeApp } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { getFirestore } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain: "untitled-world-2e645.firebaseapp.com",
  projectId: "untitled-world-2e645",
  storageBucket: "untitled-world-2e645.firebasestorage.app",
  messagingSenderId: "990115586087",
  appId: "1:990115586087:web:963f68bd59dec5ef0c6e02",
  measurementId: "G-X2PB6L0C75"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB_13GJOiLQwxsirfJ7T_4WinaxVmSp7fs",
  authDomain: "untitled-world-2e645.firebaseapp.com",
  projectId: "untitled-world-2e645",
  storageBucket: "untitled-world-2e645.firebasestorage.app",
  messagingSenderId: "990115586087",
  appId: "1:990115586087:web:963f68bd59dec5ef0c6e02",
  measurementId: "G-X2PB6L0C75"
};
document.addEventListener("DOMContentLoaded", () => {
    
    // --- VARIABLES ---
    let currentUser = "";
    let timerInterval;
    let seconds = 0;
    let isRunning = false;
    let mode = "stopwatch"; // 'stopwatch' or 'countdown'
    let initialSeconds = 0;

    // --- DOM ELEMENTS ---
    const loginOverlay = document.getElementById("loginOverlay");
    const usernameInput = document.getElementById("username");
    const loginBtn = document.getElementById("loginBtn");
    
    const display = document.getElementById("display");
    const ring = document.getElementById("ring");
    const modeLabel = document.getElementById("modeLabel");
    
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const presetBtns = document.querySelectorAll(".preset-btn");
    
    const menuToggle = document.getElementById("menuToggle");
    const navMenu = document.getElementById("navMenu");
    
    const openPanelBtn = document.getElementById("openPanelBtn");
    const closePanelBtn = document.getElementById("closePanelBtn");
    const socialSheet = document.getElementById("socialSheet");
    const backdrop = document.getElementById("backdrop");
    const userList = document.getElementById("userList");
    const inviteBtn = document.getElementById("inviteBtn");

    // --- 1. LOGIN LOGIC ---
    loginBtn.addEventListener("click", () => {
        const name = usernameInput.value.trim();
        if (name === "") {
            alert("Please enter your name!");
            return;
        }
        currentUser = name;
        loginOverlay.style.display = "none"; // Hide Login Screen
        renderUser(); // Show user in list
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
    startBtn.addEventListener("click", () => {
        if (!isRunning) {
            isRunning = true;
            startBtn.style.display = "none";
            stopBtn.style.display = "block";
            ring.classList.add("active");

            // Disable presets
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
                    // Stopwatch Mode
                    seconds++;
                    updateDisplay();
                    modeLabel.innerText = "Focus Time (Infinite)";
                }
            }, 1000);
        }
    });

    stopBtn.addEventListener("click", () => {
        clearInterval(timerInterval);
        isRunning = false;
        
        startBtn.style.display = "block";
        stopBtn.style.display = "none";
        ring.classList.remove("active");
        
        // Re-enable presets
        presetBtns.forEach(b => b.style.pointerEvents = "auto");

        // Reset Logic
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
        const url = "https://untitledworld.us.cc/timer";
        navigator.clipboard.writeText(url).then(() => {
            alert("Link Copied!");
        });
    });

    onSnapshot(collection(db,"users"), (snapshot) => {

    userList.innerHTML = "";

    snapshot.forEach(doc => {
        const u = doc.data();

        userList.innerHTML += `
        <div class="member-card">
            <div style="font-size:24px; margin-right:10px;">👤</div>
            <div>
                <div style="font-weight:bold;">${u.name}</div>
                <div style="font-size:12px;color:#00ff88;">
                    ${u.status}
                </div>
            </div>
        </div>
        `;
    });

});
});
