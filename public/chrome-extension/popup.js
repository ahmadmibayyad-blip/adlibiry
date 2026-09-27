const $ = (id) => document.getElementById(id);
const SOURCE_LABELS = {
  fb_ad_library: "Meta Ad Library",
  fb_graphql: "Facebook feed (full data)",
  fb_feed_dom: "Facebook feed (fallback)",
  tiktok_api: "TikTok (full data)",
  tiktok_dom: "TikTok (fallback)",
  adlibrary_com: "adlibrary.com",
  nexscope_web: "Nexscope (web app)",
  nexscope: "Nexscope API",
  apify: "Apify",
};

function ago(ts) {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function render() {
  chrome.storage.local.get(["adspyEnabled", "adspySubmittedCount", "adspyQueue", "adspyStats", "adspyLegacyMode"], (r) => {
    $("toggle").classList.toggle("on", r.adspyEnabled !== false);
    $("count").textContent = String(r.adspySubmittedCount || 0);
    $("queue").textContent = String((r.adspyQueue || []).length);
    const st = r.adspyStats || {};
    $("last").textContent = ago(st.lastSuccessAt);
    const rows = Object.entries(st.bySource || {}).sort((a, b) => b[1] - a[1]);
    $("sources").innerHTML = rows.length
      ? rows.map(([k, v]) => `<div class="src"><span>${SOURCE_LABELS[k] || k}</span><b>${v}</b></div>`).join("")
      : '<div class="src muted">No ads yet — browse Facebook, the Ad Library, TikTok or adlibrary.com.</div>';
    $("legacy").style.display = r.adspyLegacyMode ? "block" : "none";
    const err = st.lastError && Date.now() - (st.lastErrorAt || 0) < 3600e3 ? st.lastError : "";
    $("err").textContent = err ? "Last error: " + err : "";
  });
}

$("toggle").addEventListener("click", () => {
  chrome.storage.local.get(["adspyEnabled"], (r) => {
    chrome.storage.local.set({ adspyEnabled: r.adspyEnabled === false }, render);
  });
});
$("flush").addEventListener("click", () => {
  $("flush").textContent = "Sending…";
  chrome.runtime.sendMessage({ type: "adspy:flush" }, () => {
    $("flush").textContent = "Send queued now";
    render();
  });
});

render();
setInterval(render, 2000);
