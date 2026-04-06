// Load theme
(function(){
  const saved = localStorage.getItem("theme");

  if(saved){
    document.documentElement.setAttribute("data-theme", saved);
  } else {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute("data-theme", systemDark ? "dark" : "light");
  }
})();

// Toggle
function toggleTheme(){
  let current = document.documentElement.getAttribute("data-theme");

  if(current === "dark"){
    document.documentElement.setAttribute("data-theme","light");
    localStorage.setItem("theme","light");
  } else {
    document.documentElement.setAttribute("data-theme","dark");
    localStorage.setItem("theme","dark");
  }

  updateThemeIcon();
}

// Icon update
function updateThemeIcon(){
  const icon = document.getElementById("themeToggleIcon");
  if(!icon) return;

  let current = document.documentElement.getAttribute("data-theme");

  icon.innerHTML = current === "dark" ? "🌙" : "✨";
}

window.addEventListener("DOMContentLoaded", updateThemeIcon);