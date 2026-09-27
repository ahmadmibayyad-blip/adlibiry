// AdSpy Pro — Ad Collector content script (isolated world).
// Sources, best data first:
//   1. JSON tapped from the page's own network calls (inject.js) — full ad objects
//   2. JSON embedded in <script type="application/json"> on first page load
//   3. DOM fallback for feed ads the network tap missed
// Only ad creative data is collected. For feed pages we never send the user's
// current URL (it can be a private profile/group) — only the site origin.

(() => {
  const P = globalThis.AdSpyParsers;
  const HOST = location.hostname.replace(/^www\.|^m\./, "");
  const IS_FB = /facebook\.com$/.test(HOST);
  const IS_TT = /tiktok\.com$/.test(HOST);
  const IS_ADLIB_COM = /adlibrary\.com$/.test(HOST);
  const IS_NEXSCOPE = /nexscope\.ai$/.test(HOST);

  const seenKeys = new Set(); // adKey
  const apiContentKeys = new Set(); // contentKey of ads captured via JSON
  const pendingDom = new Map(); // contentKey -> {ad, at}
  const DOM_GRACE_MS = 7000; // give the richer JSON capture time to win

  function isAdLibraryPage() {
    return IS_FB && location.pathname.startsWith("/ads/library");
  }
  function sourceUrlFor() {
    // Search/library pages are not personal — keep the full URL there.
    if (isAdLibraryPage() || IS_ADLIB_COM || IS_NEXSCOPE) return location.href;
    return location.origin + "/";
  }
  function ctx(extra = {}) {
    return {
      host: HOST,
      sourceUrl: sourceUrlFor(),
      source: IS_ADLIB_COM ? "adlibrary_com" : IS_NEXSCOPE ? "nexscope_web" : undefined,
      ...extra,
    };
  }

  function send(ads) {
    const fresh = [];
    for (const ad of ads) {
      if (!ad || seenKeys.has(ad.adKey)) continue;
      seenKeys.add(ad.adKey);
      ad.pageLanguage = document.documentElement.lang || navigator.language;
      fresh.push(ad);
    }
    if (!fresh.length) return;
    try {
      chrome.runtime.sendMessage({ type: "adspy:ads", ads: fresh });
    } catch (e) {
      // extension reloaded — this tab's script is orphaned; stop quietly
    }
  }

  function handleJsonText(text, url) {
    const docs = P.parseJsonText(text);
    const ads = [];
    for (const d of docs) ads.push(...P.extractAds(d, ctx({ apiUrl: url })));
    for (const a of ads) {
      apiContentKeys.add(a.contentKey);
      pendingDom.delete(a.contentKey);
    }
    send(ads);
  }

  // 1. network tap
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__adspy !== 1) return;
    try {
      handleJsonText(e.data.body, e.data.url);
    } catch (err) {
      console.debug("[AdSpy Pro] parse error", err);
    }
  });

  // 2. embedded JSON (first page of Ad Library results / first feed stories)
  function scanEmbeddedJson() {
    document.querySelectorAll('script[type="application/json"]:not([data-adspy])').forEach((s) => {
      s.setAttribute("data-adspy", "1");
      const t = s.textContent || "";
      if (t.length < 100) return;
      if (IS_FB && !t.includes("sponsored_data") && !t.includes("ad_archive_id")) return;
      if (IS_TT && !/"isAd":true|"adInfo"/.test(t)) return;
      handleJsonText(t, "embedded");
    });
    if (IS_TT) {
      const u = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__") || document.getElementById("SIGI_STATE");
      if (u && !u.dataset.adspy) {
        u.dataset.adspy = "1";
        handleJsonText(u.textContent, "embedded");
      }
    }
  }

  // ── 3. DOM fallback ──────────────────────────────────────────────────────
  const SPONSORED_WORDS = [
    "sponsored", "sponsoreret", "sponsrad", "sponset", "sponsoroitu", "gesponsert", "sponsorisé", "sponsorisée",
    "patrocinado", "sponsorizzato", "gesponsord", "sponsorowane", "реклама", "ممول", "مُموَّل", "sponsorlu",
    "promoted", "ad", "annonce", "reklame", "annons", "anzeige",
  ];
  const SPONSORED_RE = new RegExp("^(" + SPONSORED_WORDS.join("|") + ")$", "i");
  const squash = (s) => (s || "").replace(/[\s​-‍﻿·]+/g, "").toLowerCase();

  function isSponsoredFbPost(post) {
    if (post.querySelector('a[href*="/ads/about"], a[href*="ads/about/?"]')) return true;
    // Facebook scrambles the label: split into many spans, some hidden. innerText
    // respects visibility, so squash it and compare against known words.
    const header = post.querySelectorAll('a[aria-label], a[role="link"] span, span[aria-labelledby], a[href="#"]');
    for (const el of header) {
      const label = el.getAttribute("aria-label");
      if (label && SPONSORED_RE.test(squash(label))) return true;
      const lb = el.getAttribute("aria-labelledby");
      if (lb) {
        const ref = document.getElementById(lb);
        if (ref && SPONSORED_RE.test(squash(ref.textContent))) return true;
      }
      const txt = squash(el.innerText);
      if (txt && txt.length < 20 && SPONSORED_RE.test(txt)) return true;
    }
    return false;
  }

  function bestImage(root, excludeSmallerThan = 180) {
    let best = null;
    let bestArea = 0;
    root.querySelectorAll("img").forEach((img) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < excludeSmallerThan || h < excludeSmallerThan) return; // avatars/emoji
      if (!/^https?:/.test(img.currentSrc || img.src)) return;
      if (w * h > bestArea) {
        best = img;
        bestArea = w * h;
      }
    });
    return best ? best.currentSrc || best.src : "";
  }

  function fbExternalLink(post) {
    for (const a of post.querySelectorAll("a[href]")) {
      const u = P.unwrapLink(a.href);
      if (!u) continue;
      try {
        const h = new URL(u).hostname;
        if (!/facebook\.com$|fbcdn\.net$|instagram\.com$|fb\.me$/.test(h)) return { url: u, el: a };
      } catch (_) {}
    }
    return null;
  }

  function fbPosts() {
    // Top-level feed units only — comments are also role="article" and used to
    // be submitted as fake "ads".
    const nodes = document.querySelectorAll('div[aria-posinset], div[data-pagelet^="FeedUnit"], [role="article"]:not([role="article"] [role="article"])');
    const out = [];
    nodes.forEach((n) => {
      if (!n.closest('[aria-posinset]') || n.matches("[aria-posinset]")) out.push(n);
    });
    return out;
  }

  function scanFacebookDom() {
    if (isAdLibraryPage()) return; // JSON tap covers the Ad Library completely
    for (const post of fbPosts()) {
      if (post.dataset.adspy === "done") continue;
      const tries = Number(post.dataset.adspyTries || 0);
      if (tries > 6) continue;
      post.dataset.adspyTries = String(tries + 1);
      if (!isSponsoredFbPost(post)) {
        if (tries >= 2) post.dataset.adspy = "done";
        continue;
      }

      const advEl = post.querySelector("h2 a, h3 a, h4 a, strong a, h2 span, h3 span, h4 span, strong span");
      const advertiser = advEl && advEl.innerText.trim();
      const msgEl = post.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], div[dir="auto"][style*="text-align"]');
      const body = msgEl ? msgEl.innerText.trim() : "";
      const video = post.querySelector("video");
      const poster = video && video.getAttribute("poster");
      const img = bestImage(post) || poster || "";
      if (!advertiser || (!img && !video)) continue; // media lazy-loaded — retry next pass

      const link = fbExternalLink(post);
      let headline = "";
      let ctaText = "";
      if (link) {
        const texts = Array.from(link.el.closest("div")?.querySelectorAll('span[dir="auto"], span') || [])
          .map((s) => s.innerText && s.innerText.trim())
          .filter((t) => t && t.length > 2 && t.length < 160);
        headline = texts.find((t) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t) && t.length > 10) || "";
      }
      const btn = Array.from(post.querySelectorAll('[role="button"], a[role="link"]')).find((b) => {
        const t = (b.innerText || "").trim();
        return t && t.length <= 24 && /shop|learn|sign|book|order|get|download|install|contact|apply|buy|køb|læs|bestil|handla|läs|köp|mehr|jetzt|acheter|en savoir|تسوق|اطلب/i.test(t);
      });
      if (btn) ctaText = btn.innerText.trim();

      post.dataset.adspy = "done";
      const ad = P.finalize(
        {
          source: "fb_feed_dom",
          platform: "Facebook",
          advertiserName: advertiser,
          headline,
          bodyText: body,
          ctaText,
          creativeUrl: img,
          images: img ? [img] : [],
          videos: video ? [{ poster: poster || undefined, hd: /^https?:/.test(video.src) ? video.src : undefined }] : [],
          mediaType: post.querySelectorAll('[aria-roledescription="carousel"], [role="list"] img').length > 2 ? "carousel" : video ? "video" : "image",
          landingPageUrl: link ? link.url : "",
          sourceUrl: sourceUrlFor(),
        },
        ctx()
      );
      queueDom(ad);
    }
  }

  function scanTikTokDom() {
    const items = document.querySelectorAll('[data-e2e="recommend-list-item-container"], [data-e2e="feed-video"], article[data-e2e], div[class*="DivItemContainer"]');
    items.forEach((item) => {
      if (item.dataset.adspy === "done") return;
      const tag = item.querySelector('[data-e2e*="ad-tag"], [data-e2e*="ad_tag"], [class*="AdTag"], [class*="Sponsor"]');
      const text = tag ? tag.innerText : "";
      const labelMatch =
        (text && /sponsored|promoted|ad|annonce|reklame|sponsoreret|sponsrad/i.test(text)) ||
        Array.from(item.querySelectorAll("span, div")).some((el) => el.children.length === 0 && SPONSORED_RE.test(squash(el.innerText)));
      if (!labelMatch) return;
      const authorEl = item.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="video-author-avatar"], a[href*="/@"]');
      if (!authorEl) return;
      const handle = (authorEl.getAttribute("href") || "").match(/\/@([^/?]+)/);
      const video = item.querySelector("video");
      const poster = (video && video.getAttribute("poster")) || bestImage(item, 150);
      const captionEl = item.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
      const ctaEl = Array.from(item.querySelectorAll("a[href], button")).find((b) => (b.innerText || "").trim().length && (b.innerText || "").trim().length <= 24 && !/^@|follow|følg|följ/i.test(b.innerText.trim()) && b.href && !/tiktok\.com/.test(b.href));
      item.dataset.adspy = "done";
      const stat = (e2e) => P.toNum((item.querySelector(`[data-e2e="${e2e}"]`) || {}).innerText);
      queueDom(
        P.finalize(
          {
            source: "tiktok_dom",
            platform: "TikTok",
            advertiserName: (item.querySelector('[data-e2e="video-author-nickname"]') || authorEl).innerText.trim() || (handle && handle[1]),
            advertiserHandle: handle ? handle[1] : undefined,
            pageUrl: handle ? `https://www.tiktok.com/@${handle[1]}` : undefined,
            headline: captionEl ? captionEl.innerText.trim().slice(0, 300) : "",
            bodyText: captionEl ? captionEl.innerText.trim() : "",
            creativeUrl: poster || "",
            videos: poster ? [{ poster }] : [],
            mediaType: "video",
            ctaText: ctaEl ? ctaEl.innerText.trim() : undefined,
            landingPageUrl: ctaEl && ctaEl.href ? ctaEl.href : "",
            likes: stat("like-count"),
            comments: stat("comment-count"),
            shares: stat("share-count"),
            saves: stat("undefined-count"),
            sourceUrl: sourceUrlFor(),
          },
          ctx()
        )
      );
    });
  }

  function queueDom(ad) {
    if (apiContentKeys.has(ad.contentKey) || seenKeys.has(ad.adKey)) return;
    if (!pendingDom.has(ad.contentKey)) pendingDom.set(ad.contentKey, { ad, at: Date.now() });
  }
  function flushDom() {
    const now = Date.now();
    const ready = [];
    for (const [k, { ad, at }] of pendingDom) {
      if (apiContentKeys.has(k)) pendingDom.delete(k);
      else if (now - at >= DOM_GRACE_MS) {
        ready.push(ad);
        pendingDom.delete(k);
      }
    }
    send(ready);
  }

  // Scheduling: MutationObserver-driven (cheap), with a slow safety interval.
  let scheduled = false;
  function scan() {
    scheduled = false;
    try {
      scanEmbeddedJson();
      if (IS_FB) scanFacebookDom();
      else if (IS_TT) scanTikTokDom();
      flushDom();
    } catch (e) {
      console.debug("[AdSpy Pro] scan error", e);
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 1200);
  }

  chrome.storage.local.get(["adspyEnabled"], (r) => {
    if (r.adspyEnabled === false) return;
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 5000);
    scan();
  });
})();
