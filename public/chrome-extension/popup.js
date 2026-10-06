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
const nf = new Intl.NumberFormat();
let sending = false;

function ago(ts) {
  if (!ts) return "Not yet";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

function renderSources(bySource) {
  const list = $("sources");
  const rows = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1]);
  list.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No ads yet. Scroll Facebook, the Ad Library, TikTok or adlibrary.com and they'll appear here.";
    list.append(li);
    return;
  }
  for (const [key, n] of rows) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    const count = document.createElement("strong");
    name.textContent = SOURCE_LABELS[key] || key;
    count.textContent = nf.format(n);
    li.append(name, count);
    list.append(li);
  }
}

function render() {
  chrome.storage.local.get(["adspyEnabled", "adspySubmittedCount", "adspyQueue", "adspyStats", "adspyLegacyMode"], (r) => {
    const on = r.adspyEnabled !== false;
    $("toggle").setAttribute("aria-checked", String(on));
    $("state").textContent = on ? "On while you browse" : "Paused. No ads are collected";

    const queued = (r.adspyQueue || []).length;
    $("count").textContent = nf.format(r.adspySubmittedCount || 0);
    $("queue").textContent = nf.format(queued);
    if (!sending) $("flush").disabled = queued === 0;

    const st = r.adspyStats || {};
    $("last").textContent = ago(st.lastSuccessAt);
    renderSources(st.bySource);

    $("legacy").hidden = !r.adspyLegacyMode;

    const err = st.lastError && Date.now() - (st.lastErrorAt || 0) < 3600e3 ? st.lastError : "";
    const errBox = $("err");
    errBox.hidden = !err;
    if (err) {
      const detail = document.createElement("code");
      detail.textContent = err;
      errBox.replaceChildren("Couldn't send some ads. They stay in the queue and retry every minute. Details: ", detail);
    }
  });
}

$("toggle").addEventListener("click", () => {
  chrome.storage.local.get(["adspyEnabled"], (r) => {
    chrome.storage.local.set({ adspyEnabled: r.adspyEnabled === false }, render);
  });
});
$("flush").addEventListener("click", () => {
  sending = true;
  $("flush").disabled = true;
  $("flush").textContent = "Sending…";
  chrome.runtime.sendMessage({ type: "adspy:flush" }, () => {
    sending = false;
    $("flush").textContent = "Send waiting ads now";
    render();
  });
});

render();
setInterval(render, 2000);
