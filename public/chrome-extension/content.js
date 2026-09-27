// AdSpy Pro — Ad Collector content script
// Runs on facebook.com and tiktok.com. Scans the page for sponsored posts,
// extracts publicly visible ad creative info, and queues it for anonymous
// submission to AdSpy Pro. Never touches or reads the signed-in user's own
// personal data — only the ad creative content itself.

const SUBMIT_ENDPOINT = "https://wandering-avocet-151.convex.site/extension/submit-ad";
const seen = new Set();

function getVisitorId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["adspyVisitorId"], (result) => {
      if (result.adspyVisitorId) {
        resolve(result.adspyVisitorId);
      } else {
        const id = crypto.randomUUID();
        chrome.storage.local.set({ adspyVisitorId: id });
        resolve(id);
      }
    });
  });
}

function isEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["adspyEnabled"], (result) => {
      resolve(result.adspyEnabled !== false); // default enabled
    });
  });
}

async function submitAd(ad) {
  const enabled = await isEnabled();
  if (!enabled) return;

  const visitorId = await getVisitorId();
  try {
    const res = await fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ad, visitorId }),
    });
    if (res.ok) {
      chrome.storage.local.get(["adspySubmittedCount"], (result) => {
        chrome.storage.local.set({ adspySubmittedCount: (result.adspySubmittedCount || 0) + 1 });
      });
    }
  } catch (err) {
    console.error("[AdSpy Pro] Failed to submit ad:", err);
  }
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return String(h);
}

// ── Facebook: sponsored posts are marked with a "Sponsored" label in the feed ──
function scanFacebook() {
  const posts = document.querySelectorAll('[role="article"]');
  posts.forEach((post) => {
    const text = post.textContent || "";
    if (!/Sponsored/i.test(text)) return;

    const img = post.querySelector("img[src*='scontent']");
    const links = post.querySelectorAll("a[href]");
    const advertiserEl = post.querySelector("strong, h2, h3");
    const headlineCandidates = Array.from(post.querySelectorAll("span"))
      .map((s) => s.textContent?.trim())
      .filter((t) => t && t.length > 15 && t.length < 200);

    if (!img || !advertiserEl) return;

    const key = hash(img.src + advertiserEl.textContent);
    if (seen.has(key)) return;
    seen.add(key);

    submitAd({
      advertiserName: advertiserEl.textContent?.trim().slice(0, 200) || "Unknown",
      platform: "Facebook",
      headline: headlineCandidates[0] || "Sponsored post",
      bodyText: headlineCandidates.slice(1, 3).join(" ") || "",
      creativeUrl: img.src,
      landingPageUrl: links[0]?.href || "",
      sourceUrl: window.location.href,
    });
  });
}

// ── TikTok: sponsored videos show "Sponsored" in the caption area ──────────
function scanTikTok() {
  const items = document.querySelectorAll('[data-e2e="feed-video"], div[class*="DivItemContainer"]');
  items.forEach((item) => {
    const text = item.textContent || "";
    if (!/Sponsored|Promoted/i.test(text)) return;

    const video = item.querySelector("video");
    const poster = video?.getAttribute("poster");
    const authorEl = item.querySelector('[data-e2e="video-author-uniqueid"], a[href*="/@"]');
    const captionEl = item.querySelector('[data-e2e="video-desc"]');

    if (!authorEl) return;

    const key = hash((poster || "") + authorEl.textContent);
    if (seen.has(key)) return;
    seen.add(key);

    submitAd({
      advertiserName: authorEl.textContent?.trim().slice(0, 200) || "Unknown",
      platform: "TikTok",
      headline: captionEl?.textContent?.trim().slice(0, 200) || "Sponsored video",
      bodyText: "",
      creativeUrl: poster || "",
      landingPageUrl: "",
      sourceUrl: window.location.href,
    });
  });
}

function scan() {
  if (window.location.hostname.includes("tiktok.com")) {
    scanTikTok();
  } else {
    scanFacebook();
  }
}

// Feeds are infinite-scroll SPAs — rescan periodically instead of relying on one pass.
setInterval(scan, 4000);
scan();
