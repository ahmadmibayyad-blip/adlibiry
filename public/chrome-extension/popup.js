const toggle = document.getElementById("toggle");
const countEl = document.getElementById("count");

chrome.storage.local.get(["adspyEnabled", "adspySubmittedCount"], (result) => {
  const enabled = result.adspyEnabled !== false;
  toggle.classList.toggle("on", enabled);
  countEl.textContent = String(result.adspySubmittedCount || 0);
});

toggle.addEventListener("click", () => {
  chrome.storage.local.get(["adspyEnabled"], (result) => {
    const next = !(result.adspyEnabled !== false);
    chrome.storage.local.set({ adspyEnabled: next });
    toggle.classList.toggle("on", next);
  });
});
