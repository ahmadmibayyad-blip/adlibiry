// AdSpy Pro — background service worker.
// Owns ALL network submission (content-script fetches from facebook.com /
// tiktok.com origins are subject to CORS; the worker with host_permissions is
// not). Adds: persistent queue, cross-tab/persistent de-dup, retries with
// backoff, and automatic fallback to the old 7-field payload if the backend
// rejects the extended fields.

const SUBMIT_ENDPOINT = "https://careful-raccoon-363.convex.site/extension/submit-ad";
const VERSION = chrome.runtime.getManifest().version;
const LEGACY_FIELDS = ["advertiserName", "platform", "headline", "bodyText", "creativeUrl", "landingPageUrl", "sourceUrl"];
const MAX_QUEUE = 3000;
const MAX_SEEN = 10000;
const MAX_ATTEMPTS = 6;
const BATCH = 15;
const LEGACY_RETRY_MS = 6 * 3600 * 1000;

const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

chrome.runtime.onInstalled.addListener(async () => {
  const s = await get(["adspyEnabled"]);
  if (s.adspyEnabled === undefined) await set({ adspyEnabled: true });
  chrome.alarms.create("adspy-flush", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("adspy-flush", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((a) => a.name === "adspy-flush" && flush());

async function visitorId() {
  const s = await get(["adspyVisitorId"]);
  if (s.adspyVisitorId) return s.adspyVisitorId;
  const id = crypto.randomUUID();
  await set({ adspyVisitorId: id });
  return id;
}

// Serialize storage mutations (several tabs can message at once).
let chain = Promise.resolve();
const locked = (fn) => (chain = chain.then(fn, fn));

function enqueue(ads) {
  return locked(async () => {
    const s = await get(["adspyQueue", "adspySeen", "adspyEnabled"]);
    if (s.adspyEnabled === false) return;
    const queue = s.adspyQueue || [];
    const seen = s.adspySeen || [];
    const known = new Set([...seen, ...queue.map((q) => q.ad.adKey)]);
    let added = 0;
    for (const ad of ads) {
      if (!ad || !ad.adKey || known.has(ad.adKey)) continue;
      known.add(ad.adKey);
      queue.push({ ad, attempts: 0 });
      added++;
    }
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    await set({ adspyQueue: queue });
    return added;
  });
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const vid = await visitorId();
    for (let round = 0; round < 20; round++) {
      const s = await get(["adspyQueue", "adspyLegacyMode", "adspyLegacySince", "adspyEnabled"]);
      if (s.adspyEnabled === false) return;
      const queue = s.adspyQueue || [];
      if (!queue.length) return;
      let legacy = !!s.adspyLegacyMode;
      if (legacy && Date.now() - (s.adspyLegacySince || 0) > LEGACY_RETRY_MS) legacy = false; // re-probe

      const batch = queue.slice(0, BATCH);
      const results = [];
      let networkDown = false;
      for (const item of batch) {
        const r = await submitOne(item.ad, vid, legacy);
        if (r.switchedToLegacy) legacy = true;
        results.push({ item, r });
        if (r.network) {
          networkDown = true;
          break;
        }
      }
      await locked(async () => {
        const st = await get(["adspyQueue", "adspySeen", "adspyStats", "adspySubmittedCount"]);
        const q = st.adspyQueue || [];
        const seen = st.adspySeen || [];
        const stats = st.adspyStats || { submitted: 0, failed: 0, bySource: {}, byPlatform: {} };
        let count = st.adspySubmittedCount || 0;
        const done = new Set();
        for (const { item, r } of results) {
          const key = item.ad.adKey;
          if (r.ok) {
            done.add(key);
            seen.push(key);
            count++;
            stats.submitted++;
            const src = item.ad.source || "unknown";
            stats.bySource[src] = (stats.bySource[src] || 0) + 1;
            stats.byPlatform[item.ad.platform] = (stats.byPlatform[item.ad.platform] || 0) + 1;
            stats.lastSuccessAt = Date.now();
          } else if (r.fatal || item.attempts + 1 >= MAX_ATTEMPTS) {
            done.add(key);
            seen.push(key); // don't loop on a permanently-bad ad
            stats.failed++;
            stats.lastError = r.error;
            stats.lastErrorAt = Date.now();
          } else {
            const qi = q.find((x) => x.ad.adKey === key);
            if (qi) qi.attempts++;
            stats.lastError = r.error;
            stats.lastErrorAt = Date.now();
          }
        }
        const nq = q.filter((x) => !done.has(x.ad.adKey));
        if (seen.length > MAX_SEEN) seen.splice(0, seen.length - MAX_SEEN);
        const patch = { adspyQueue: nq, adspySeen: seen, adspyStats: stats, adspySubmittedCount: count };
        if (legacy !== !!s.adspyLegacyMode) {
          patch.adspyLegacyMode = legacy;
          patch.adspyLegacySince = legacy ? Date.now() : 0;
        }
        await set(patch);
        updateBadge(count);
      });
      if (networkDown) return;
    }
  } finally {
    flushing = false;
  }
}

function legacyPayload(ad) {
  const o = {};
  for (const k of LEGACY_FIELDS) o[k] = ad[k] || "";
  return o;
}

async function post(body) {
  const res = await fetch(SUBMIT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let text = "";
  try {
    text = (await res.text()).slice(0, 300);
  } catch (_) {}
  return { status: res.status, ok: res.ok, text };
}

async function submitOne(ad, vid, legacy) {
  try {
    if (!legacy) {
      const r = await post({ ...ad, visitorId: vid, extensionVersion: VERSION });
      if (r.ok) return { ok: true };
      if ([400, 413, 422].includes(r.status)) {
        // Backend validator probably rejects the new fields → fall back.
        const r2 = await post({ ...legacyPayload(ad), visitorId: vid });
        if (r2.ok) return { ok: true, switchedToLegacy: true };
        return { fatal: true, error: `HTTP ${r2.status}: ${r2.text}` };
      }
      return { error: `HTTP ${r.status}: ${r.text}`, fatal: r.status >= 400 && r.status < 500 && r.status !== 429 };
    }
    const r = await post({ ...legacyPayload(ad), visitorId: vid });
    if (r.ok) return { ok: true };
    return { error: `HTTP ${r.status}: ${r.text}`, fatal: r.status >= 400 && r.status < 500 && r.status !== 429 };
  } catch (e) {
    return { network: true, error: String(e && e.message ? e.message : e) };
  }
}

function updateBadge(n) {
  const t = n >= 1000 ? Math.floor(n / 1000) + "k" : n ? String(n) : "";
  chrome.action.setBadgeText({ text: t });
  chrome.action.setBadgeBackgroundColor({ color: "#1fbf6b" });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "adspy:ads" && Array.isArray(msg.ads)) {
    enqueue(msg.ads).then(() => flush());
  } else if (msg && msg.type === "adspy:flush") {
    flush().then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg && msg.type === "adspy:clearSeen") {
    set({ adspySeen: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
