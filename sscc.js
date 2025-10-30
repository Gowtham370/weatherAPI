// ====== City Suggestions (Smooth Dropdown) + Navigation Handlers ======

const CITY_SUGGESTIONS = ["Hyderabad", "Delhi", "Bengaluru", "Kolkata", "Mumbai"];

// Map input IDs to suggestion containers
const suggestionMap = [
  { input: "singleCityInput", container: "suggestWrapSingle" },
  { input: "cityOne", container: "suggestWrapOne" },
  { input: "cityTwo", container: "suggestWrapTwo" },
];

function createSuggestionList(suggestWrap, items) {
  suggestWrap.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "city-suggest-list";
  items.forEach((city) => {
    const li = document.createElement("li");
    li.className = "city-suggest-item";
    li.textContent = city;
    ul.appendChild(li);
  });
  suggestWrap.appendChild(ul);
}

suggestionMap.forEach(({ input, container }) => {
  const inputEl = document.getElementById(input);
  const suggestWrap = document.getElementById(container);
  if (!inputEl || !suggestWrap) return;

  const show = (list) => { createSuggestionList(suggestWrap, list); suggestWrap.classList.add("visible"); };
  const hide = () => { suggestWrap.classList.remove("visible"); };

  // Filter as user types
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim().toLowerCase();
    const list = q ? CITY_SUGGESTIONS.filter(c => c.toLowerCase().includes(q)) : CITY_SUGGESTIONS;
    list.length ? show(list) : hide();
  });

  // Show on focus
  inputEl.addEventListener("focus", () => {
    const q = inputEl.value.trim().toLowerCase();
    const list = q ? CITY_SUGGESTIONS.filter(c => c.toLowerCase().includes(q)) : CITY_SUGGESTIONS;
    show(list);
  });

  // Hide on blur (allow click)
  inputEl.addEventListener("blur", () => setTimeout(hide, 150));

  // Click select (use mousedown to avoid blur)
  suggestWrap.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".city-suggest-item");
    if (!item) return;
    inputEl.value = item.textContent;
    hide();
  });

  // Enter selects first visible suggestion
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = suggestWrap.querySelector(".city-suggest-item");
      if (first) {
        inputEl.value = first.textContent;
        hide();
        e.preventDefault();
      }
    }
  });
});

// ----- Navigation with fade and button handlers -----
function navigateWithFade(url) {
  document.body.classList.add("fade-out");
  setTimeout(() => { window.location.href = url; }, 500);
}

const searchBtn  = document.getElementById("singleSearchBtn");
const compareBtn = document.getElementById("multiSearchBtn");
const clearBtn   = document.getElementById("clearChipsBtn");

// Single: click + Enter on input
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    const city = document.getElementById("singleCityInput").value.trim();
    if (!city) return alert("Please enter a city name!");
    navigateWithFade(`analysis.html?city=${encodeURIComponent(city)}`);
  });
  const singleInput = document.getElementById("singleCityInput");
  singleInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchBtn.click();
    }
  });
}

// Compare: click + Enter on either input to submit if both filled
if (compareBtn) {
  compareBtn.addEventListener("click", () => {
    const city1 = document.getElementById("cityOne").value.trim();
    const city2 = document.getElementById("cityTwo").value.trim();
    if (!city1 || !city2) return alert("Please enter both cities!");
    navigateWithFade(`analysis.html?city1=${encodeURIComponent(city1)}&city2=${encodeURIComponent(city2)}`);
  });

  const trySubmitCompare = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      compareBtn.click();
    }
  };
  document.getElementById("cityOne")?.addEventListener("keydown", trySubmitCompare);
  document.getElementById("cityTwo")?.addEventListener("keydown", trySubmitCompare);
}

// Clear
clearBtn?.addEventListener("click", () => {
  const c1 = document.getElementById("cityOne");
  const c2 = document.getElementById("cityTwo");
  if (c1) c1.value = "";
  if (c2) c2.value = "";
});
