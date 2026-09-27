// AdSpy Pro — parsers. Turn raw JSON (Facebook GraphQL, Meta Ad Library,
// TikTok item lists, adlibrary.com API responses, Apify dataset items) into one
// normalized ad shape. Pure functions — also usable server-side (Node/Convex).
(function (root) {
  const isObj = (v) => v !== null && typeof v === "object";
  const isStr = (v) => typeof v === "string" && v.trim().length > 0;
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const isHttp = (v) => isStr(v) && /^https?:\/\//i.test(v);

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  // Facebook streams several JSON docs per response and sometimes prefixes "for (;;);".
  function parseJsonText(text) {
    if (!isStr(text)) return [];
    const t = text.replace(/^\s*for \(;;\);/, "");
    try {
      return [JSON.parse(t)];
    } catch (_) {}
    const out = [];
    for (const line of t.split(/\r?\n/)) {
      const l = line.trim();
      if (l[0] !== "{" && l[0] !== "[") continue;
      try {
        out.push(JSON.parse(l));
      } catch (_) {}
    }
    return out;
  }

  // Walk JSON depth-first. visit(node) returning false = don't descend.
  function walk(rootNode, visit, maxDepth = 80) {
    const stack = [[rootNode, 0]];
    const seen = new Set();
    while (stack.length) {
      const [n, d] = stack.pop();
      if (!isObj(n) || seen.has(n) || d > maxDepth) continue;
      seen.add(n);
      if (visit(n) === false) continue;
      const keys = Object.keys(n);
      for (let i = keys.length - 1; i >= 0; i--) {
        const v = n[keys[i]];
        if (isObj(v)) stack.push([v, d + 1]);
      }
    }
  }

  // Breadth-first: returns the SHALLOWEST value whose key/value pass the tests.
  function findKey(rootNode, keyTest, valTest = () => true, maxDepth = 30) {
    if (!isObj(rootNode)) return undefined;
    const q = [[rootNode, 0]];
    const seen = new Set();
    for (let i = 0; i < q.length; i++) {
      const [n, d] = q[i];
      if (seen.has(n)) continue;
      seen.add(n);
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (keyTest(k) && valTest(v)) return v;
        if (isObj(v) && d < maxDepth) q.push([v, d + 1]);
      }
    }
    return undefined;
  }
  const keyIs = (...names) => {
    const set = new Set(names.map((n) => n.toLowerCase()));
    return (k) => set.has(k.toLowerCase());
  };

  // pick(obj, "a", "b.c", ...) → first non-empty value.
  function pick(o, ...paths) {
    for (const p of paths) {
      let v = o;
      for (const part of p.split(".")) {
        if (!isObj(v)) {
          v = undefined;
          break;
        }
        v = v[part];
      }
      if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) return v;
    }
    return undefined;
  }

  function toIso(v) {
    if (v === undefined || v === null || v === "") return undefined;
    if (isNum(v) || /^\d+$/.test(String(v))) {
      const n = Number(v);
      const d = new Date(n < 1e12 ? n * 1000 : n);
      return isNaN(d) ? undefined : d.toISOString();
    }
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toISOString();
  }

  function toNum(v) {
    if (isNum(v)) return v;
    if (!isStr(v)) return undefined;
    const m = v.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return undefined;
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
  }

  // l.facebook.com/l.php?u=<real url>  →  <real url>, and strip fbclid.
  function unwrapLink(u) {
    if (!isStr(u)) return undefined;
    try {
      const url = new URL(u, "https://www.facebook.com");
      if (/(^|\.)l\.facebook\.com$|(^|\.)lm\.facebook\.com$/.test(url.hostname) || url.pathname === "/l.php") {
        const inner = url.searchParams.get("u");
        if (inner) return unwrapLink(inner);
      }
      url.searchParams.delete("fbclid");
      return url.toString();
    } catch (_) {
      return u;
    }
  }
  const isExternal = (u) =>
    isHttp(u) && !/(^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fbcdn\.net|instagram\.com|fb\.me|tiktok\.com|tiktokcdn[^/]*)\/)/i.test(unwrapLink(u) || "");

  const clean = (s, max = 5000) => (isStr(s) ? s.replace(/\s+\n/g, "\n").trim().slice(0, max) : undefined);
  const hasTemplate = (s) => isStr(s) && /\{\{[^}]+\}\}/.test(s);

  // ── Final shape. Legacy fields (first 7) always present as strings. ──
  function finalize(ad, ctx = {}) {
    const out = {
      advertiserName: clean(ad.advertiserName, 200) || "Unknown",
      platform: ad.platform || "Facebook",
      headline: clean(ad.headline, 300) || "",
      bodyText: clean(ad.bodyText) || "",
      creativeUrl: ad.creativeUrl || "",
      landingPageUrl: unwrapLink(ad.landingPageUrl) || "",
      sourceUrl: ad.sourceUrl || ctx.sourceUrl || "",
    };
    for (const [k, v] of Object.entries(ad)) {
      if (k in out || v === undefined || v === null || v === "") continue;
      if (Array.isArray(v) && !v.length) continue;
      out[k] = v;
    }
    out.capturedAt = new Date().toISOString();
    const id = out.adArchiveId || out.adId;
    const ns = out.adArchiveId || /^(fb_|tiktok_|nexscope)/.test(out.source || "") ? out.platform : `${out.source || "x"}:${out.platform}`;
    out.adKey = id
      ? `${ns}:${id}`
      : "h:" + hash([out.platform, out.advertiserName.toLowerCase(), out.bodyText.slice(0, 160), (out.creativeUrl || "").split("?")[0]].join("|"));
    out.contentKey = contentKey(out.advertiserName, out.bodyText || out.headline);
    return out;
  }
  function contentKey(advertiser, text) {
    const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 120);
    return "c:" + hash(norm(advertiser) + "|" + norm(text));
  }

  // ── Meta Ad Library node (also Apify "Facebook Ads Library Scraper" items) ──
  // Accepts snake_case (GraphQL / curious_coder actor) and camelCase (apify actor).
  function fromAdLibrary(n, ctx = {}) {
    const s = pick(n, "snapshot") || {};
    const cardsRaw = pick(s, "cards") || [];
    const cards = cardsRaw.map((c) => ({
      title: clean(pick(c, "title")),
      body: clean(pick(c, "body", "body.text")),
      linkUrl: unwrapLink(pick(c, "link_url", "linkUrl")),
      caption: pick(c, "caption"),
      ctaText: pick(c, "cta_text", "ctaText"),
      image: pick(c, "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl"),
      videoHd: pick(c, "video_hd_url", "videoHdUrl"),
      videoSd: pick(c, "video_sd_url", "videoSdUrl"),
      poster: pick(c, "video_preview_image_url", "videoPreviewImageUrl"),
    }));
    const images = (pick(s, "images") || [])
      .map((i) => pick(i, "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl"))
      .filter(Boolean);
    let videos = (pick(s, "videos") || []).map((v) => ({
      hd: pick(v, "video_hd_url", "videoHdUrl"),
      sd: pick(v, "video_sd_url", "videoSdUrl"),
      poster: pick(v, "video_preview_image_url", "videoPreviewImageUrl"),
    }));
    if (!videos.length) videos = cards.filter((c) => c.videoHd || c.videoSd).map((c) => ({ hd: c.videoHd, sd: c.videoSd, poster: c.poster }));

    let body = pick(s, "body.text", "body.markup.__html");
    if (!isStr(body) && isStr(s.body)) body = s.body;
    if ((!isStr(body) || hasTemplate(body)) && cards[0] && cards[0].body) body = cards[0].body; // DCO/DPA templates
    let headline = pick(s, "title");
    if ((!isStr(headline) || hasTemplate(headline)) && cards[0]) headline = cards[0].title;

    const fmt = String(pick(s, "display_format", "displayFormat") || "").toLowerCase();
    const mediaType =
      fmt === "carousel" || cards.length > 1 ? "carousel" : fmt === "dco" || fmt === "dpa" ? fmt : videos.length ? "video" : "image";
    const archiveId = String(pick(n, "ad_archive_id", "adArchiveID", "adArchiveId") || "");
    const pageId = pick(n, "page_id", "pageID", "pageId") || pick(s, "page_id", "pageId");
    const platforms = (pick(n, "publisher_platform", "publisherPlatform") || []).map((p) => String(p).toLowerCase());

    return finalize(
      {
        source: ctx.source || "fb_ad_library",
        platform: platforms.length === 1 && platforms[0] === "instagram" ? "Instagram" : "Facebook",
        adArchiveId: archiveId || undefined,
        adId: pick(n, "ad_id", "adId") ? String(pick(n, "ad_id", "adId")) : undefined,
        adLibraryUrl: archiveId ? `https://www.facebook.com/ads/library/?id=${archiveId}` : undefined,
        pageId: pageId ? String(pageId) : undefined,
        advertiserName: pick(n, "page_name", "pageName") || pick(s, "page_name", "pageName"),
        pageUrl: pick(s, "page_profile_uri", "pageProfileUri"),
        advertiserAvatar: pick(s, "page_profile_picture_url", "pageProfilePictureUrl"),
        pageLikes: toNum(pick(s, "page_like_count", "pageLikeCount")),
        pageCategories: pick(s, "page_categories", "pageCategories"),
        headline,
        bodyText: body,
        ctaText: pick(s, "cta_text", "ctaText") || (cards[0] && cards[0].ctaText),
        ctaType: pick(s, "cta_type", "ctaType"),
        linkCaption: pick(s, "caption"),
        linkDescription: pick(s, "link_description", "linkDescription"),
        landingPageUrl: pick(s, "link_url", "linkUrl") || (cards.find((c) => c.linkUrl) || {}).linkUrl,
        creativeUrl: images[0] || (videos[0] && videos[0].poster) || (cards[0] && (cards[0].image || cards[0].poster)) || "",
        images,
        videos,
        cards: cards.length > 1 || mediaType === "dco" ? cards : undefined,
        mediaType,
        startDate: toIso(pick(n, "start_date", "startDate", "startDateFormatted")),
        endDate: toIso(pick(n, "end_date", "endDate", "endDateFormatted")),
        isActive: pick(n, "is_active", "isActive"),
        platforms,
        collationCount: pick(n, "collation_count", "collationCount"),
        collationId: pick(n, "collation_id", "collationID", "collationId") ? String(pick(n, "collation_id", "collationID", "collationId")) : undefined,
        countries: pick(n, "targeted_or_reached_countries", "targetedOrReachedCountries", "reached_countries"),
        reach: pick(n, "reach_estimate", "reachEstimate", "eu_total_reach", "euTotalReach"),
        spend: pick(n, "spend"),
        currency: pick(n, "currency"),
        impressions: pick(n, "impressions_with_index.impressions_text", "impressionsWithIndex.impressionsText"),
        categories: pick(n, "categories"),
        sourceUrl: ctx.sourceUrl,
      },
      ctx
    );
  }

  // ── Facebook / Instagram feed story that carries sponsored_data ──
  function fromFeedStory(n, ctx = {}) {
    const actors = findKey(n, keyIs("actors", "owning_profile"), (v) => (Array.isArray(v) ? v[0] && v[0].name : v && v.name));
    const actor = Array.isArray(actors) ? actors[0] : actors || {};
    const message =
      findKey(n, keyIs("message"), (v) => isObj(v) && isStr(v.text)) ||
      findKey(n, keyIs("message_preferred_body", "body"), (v) => isObj(v) && isStr(v.text));
    const attachments = findKey(n, keyIs("attachments"), (v) => Array.isArray(v) && v.length) || [];
    const att = attachments[0] || n;
    const sub = findKey(att, keyIs("all_subattachments", "subattachments"), (v) => isObj(v) && Array.isArray(v.nodes));

    const imgOf = (o) =>
      (findKey(o, keyIs("photo_image", "large_share_image", "image", "preferred_thumbnail", "thumbnailImage"), (v) => isObj(v) && (isHttp(v.uri) || (isObj(v.image) && isHttp(v.image.uri)))) || {});
    const imageObj = imgOf(att);
    const creative = imageObj.uri || (imageObj.image && imageObj.image.uri);

    const videoHd = findKey(n, keyIs("browser_native_hd_url", "playable_url_quality_hd", "hd_src"), isHttp);
    const videoSd = findKey(n, keyIs("browser_native_sd_url", "playable_url", "sd_src"), isHttp);

    const link =
      findKey(att, keyIs("external_url", "link_url", "website_url"), isExternal) ||
      findKey(att, keyIs("url", "uri"), isExternal) ||
      findKey(n, keyIs("url"), isExternal);
    const titleObj = findKey(att, keyIs("title_with_entities"), (v) => isObj(v) && isStr(v.text));
    const title = (titleObj && titleObj.text) || findKey(att, keyIs("title", "name"), isStr);
    const ctaObj = findKey(n, keyIs("call_to_action", "cta", "call_to_action_renderer"), isObj);
    const ctaText =
      findKey(n, keyIs("cta_text", "call_to_action_text", "button_text", "action_text"), isStr) ||
      (ctaObj && (findKey(ctaObj, keyIs("label", "title", "text"), isStr)));
    const ctaType = findKey(n, keyIs("cta_type", "call_to_action_type", "link_type"), isStr);

    const cards = sub
      ? sub.nodes.map((c) => {
          const im = imgOf(c);
          const t = findKey(c, keyIs("title_with_entities"), (v) => isObj(v) && isStr(v.text));
          return {
            title: (t && t.text) || findKey(c, keyIs("title", "name"), isStr),
            linkUrl: unwrapLink(findKey(c, keyIs("url", "external_url"), isExternal)),
            image: im.uri || (im.image && im.image.uri),
          };
        })
      : undefined;

    const out = {
      source: ctx.source || "fb_graphql",
      platform: ctx.platform || "Facebook",
      adId: String((n.sponsored_data && (n.sponsored_data.ad_id || n.sponsored_data.id)) || "") || undefined,
      pageId: actor.id ? String(actor.id) : undefined,
      advertiserName: actor.name,
      pageUrl: actor.url || actor.profile_url,
      advertiserAvatar: (actor.profile_picture && actor.profile_picture.uri) || undefined,
      headline: title,
      bodyText: message && message.text,
      ctaText,
      ctaType,
      landingPageUrl: link,
      creativeUrl: creative || "",
      images: creative ? [creative] : [],
      videos: videoHd || videoSd ? [{ hd: videoHd, sd: videoSd, poster: creative }] : [],
      cards: cards && cards.length > 1 ? cards : undefined,
      mediaType: cards && cards.length > 1 ? "carousel" : videoHd || videoSd ? "video" : "image",
      reactions: (findKey(n, keyIs("reaction_count", "reactors"), (v) => isObj(v) && isNum(v.count)) || {}).count,
      comments:
        findKey(n, keyIs("total_comment_count"), isNum) ??
        (findKey(n, keyIs("comments", "comment_count"), (v) => isObj(v) && isNum(v.total_count)) || {}).total_count,
      shares: (findKey(n, keyIs("share_count", "reshares"), (v) => isObj(v) && isNum(v.count)) || {}).count,
      views: findKey(n, keyIs("video_view_count", "play_count", "post_view_count"), isNum),
      postedAt: toIso(findKey(n, keyIs("creation_time", "publish_time"), isNum)),
      sourceUrl: ctx.sourceUrl,
    };
    if (!out.advertiserName && !out.bodyText && !out.creativeUrl) return null;
    return finalize(out, ctx);
  }

  // ── TikTok web item (itemList entries) ──
  function isTikTokAd(n) {
    return n.isAd === true || n.is_ad === true || isObj(n.adInfo) || isObj(n.ad_info) || isStr(n.adLabel);
  }
  function fromTikTok(n, ctx = {}) {
    const a = n.author || {};
    const v = n.video || {};
    const st = n.statsV2 || n.stats || {};
    const id = String(n.id || n.aweme_id || "");
    const uid = a.uniqueId || a.unique_id;
    const landing =
      findKey(n, (k) => /^(landing_?page_?url|web_?url|click_?url|open_?url|ad_?link|display_?url)$/i.test(k), isExternal) ||
      findKey(n.anchors || n.adInfo || n.ad_info || {}, keyIs("url", "schema", "link"), isExternal);
    const poster = v.cover || v.originCover || v.dynamicCover || (v.cover && v.cover.url_list && v.cover.url_list[0]);
    return finalize(
      {
        source: "tiktok_api",
        platform: "TikTok",
        adId: id || undefined,
        advertiserName: a.nickname || uid,
        advertiserHandle: uid,
        pageId: a.id ? String(a.id) : undefined,
        pageUrl: uid ? `https://www.tiktok.com/@${uid}` : undefined,
        advertiserAvatar: a.avatarThumb || a.avatarMedium,
        pageLikes: toNum((n.authorStats || {}).followerCount),
        headline: clean(n.desc, 300),
        bodyText: n.desc,
        ctaText: findKey(n.adInfo || n.ad_info || {}, (k) => /button_?text|cta/i.test(k), isStr),
        landingPageUrl: landing,
        creativeUrl: poster || "",
        videos: [{ hd: v.playAddr || v.downloadAddr, sd: v.downloadAddr, poster }].filter((x) => x.hd || x.poster),
        mediaType: "video",
        durationSec: v.duration,
        views: toNum(st.playCount),
        likes: toNum(st.diggCount),
        comments: toNum(st.commentCount),
        shares: toNum(st.shareCount),
        saves: toNum(st.collectCount),
        music: n.music ? [n.music.title, n.music.authorName].filter(Boolean).join(" — ") : undefined,
        postedAt: toIso(n.createTime),
        videoUrl: uid && id ? `https://www.tiktok.com/@${uid}/video/${id}` : undefined,
        sourceUrl: ctx.sourceUrl,
      },
      ctx
    );
  }

  // ── adlibrary.com / unknown APIs: score-based detection + generic mapping ──
  const K = {
    id: ["id", "ad_id", "adId", "_id", "uuid", "ad_archive_id", "creative_id", "creativeId"],
    adv: ["advertiser_name", "advertiserName", "advertiser.name", "advertiser", "page_name", "pageName", "brand_name", "brandName", "brand.name", "brand", "page.name", "account_name"],
    img: ["image_url", "imageUrl", "thumbnail_url", "thumbnailUrl", "thumbnail", "preview_url", "previewUrl", "creative_url", "creativeUrl", "media_url", "mediaUrl", "image", "images.0.url", "images.0", "media.0.url", "media.0.thumbnail", "creatives.0.image_url", "creatives.0.thumbnail_url", "cover"],
    vid: ["video_url", "videoUrl", "video_hd_url", "videoHdUrl", "video", "videos.0.url", "videos.0", "media.0.video_url", "creatives.0.video_url"],
    body: ["body", "body.text", "ad_text", "adText", "primary_text", "primaryText", "text", "copy", "description", "message", "caption", "creatives.0.body"],
    head: ["headline", "title", "link_title", "linkTitle", "creatives.0.title"],
    link: ["landing_page_url", "landingPageUrl", "landing_page", "landingPage", "link_url", "linkUrl", "destination_url", "destinationUrl", "url", "final_url", "finalUrl", "store_url"],
    cta: ["cta_text", "ctaText", "cta", "call_to_action", "callToAction", "button_text"],
    start: ["start_date", "startDate", "first_seen", "firstSeen", "first_seen_at", "created_at", "createdAt", "published_at"],
    end: ["end_date", "endDate", "last_seen", "lastSeen", "last_seen_at", "updated_at"],
    plat: ["platform", "network", "channel", "source", "publisher_platform", "platforms"],
    imp: ["impressions", "impression_count", "estimated_impressions", "reach", "views", "view_count"],
    days: ["days_running", "daysRunning", "runtime", "run_days", "duration_days", "active_days"],
    likes: ["likes", "like_count", "likeCount", "reactions", "digg_count"],
    comments: ["comments", "comment_count", "commentCount"],
    shares: ["shares", "share_count", "shareCount"],
    country: ["countries", "country", "country_codes", "geo", "locations"],
    active: ["is_active", "isActive", "active", "status"],
    spend: ["spend", "estimated_spend", "spend_estimate"],
    lang: ["language", "lang", "languages"],
  };
  const has = (o, list, test = (v) => v !== undefined) => test(pick(o, ...list));
  function looksLikeAd(n) {
    if (Array.isArray(n)) return false;
    let score = 0;
    if (has(n, K.id)) score += 1;
    const advOk = has(n, K.adv, (v) => isStr(v) || (isObj(v) && isStr(v.name)));
    if (advOk) score += 2;
    const mediaOk = has(n, K.img, (v) => isHttp(v) || (isObj(v) && isHttp(v.url))) || has(n, K.vid, (v) => isHttp(v) || (isObj(v) && isHttp(v.url)));
    if (mediaOk) score += 2;
    if (has(n, K.body, isStr) || has(n, K.head, isStr)) score += 1;
    if (has(n, K.start)) score += 1;
    if (has(n, K.plat)) score += 1;
    if (has(n, K.cta) || has(n, K.link, isHttp)) score += 1;
    return score >= 5 && (advOk || mediaOk);
  }
  const PLATFORM_MAP = [
    [/meta|facebook|fb\b|audience/i, "Facebook"],
    [/insta/i, "Instagram"],
    [/tiktok/i, "TikTok"],
    [/youtube/i, "YouTube"],
    [/google|adwords/i, "Google"],
    [/linkedin/i, "LinkedIn"],
    [/pinterest/i, "Pinterest"],
    [/snap/i, "Snapchat"],
    [/twitter|\bx\b/i, "X"],
    [/reddit/i, "Reddit"],
  ];
  function normPlatform(p) {
    const s = Array.isArray(p) ? p.join(",") : isObj(p) ? p.name || "" : String(p || "");
    for (const [re, name] of PLATFORM_MAP) if (re.test(s)) return name;
    return s ? s.slice(0, 40) : "Unknown";
  }
  const urlOf = (v) => (isHttp(v) ? v : isObj(v) && isHttp(v.url) ? v.url : undefined);
  const strOf = (v) => (isStr(v) ? v : isObj(v) ? v.name || v.text || v.label : undefined);

  function fromGeneric(n, ctx = {}) {
    // Many aggregators re-serve Meta Ad Library objects verbatim.
    if (pick(n, "ad_archive_id", "adArchiveID", "adArchiveId") && pick(n, "snapshot")) return fromAdLibrary(n, ctx);
    const platRaw = pick(n, ...K.plat);
    const video = urlOf(pick(n, ...K.vid));
    const image = urlOf(pick(n, ...K.img));
    const id = pick(n, ...K.id);
    let raw;
    try {
      raw = JSON.stringify(n);
      if (raw.length > 20000) raw = raw.slice(0, 20000);
    } catch (_) {}
    return finalize(
      {
        source: ctx.source || "generic",
        platform: normPlatform(platRaw),
        platforms: Array.isArray(platRaw) ? platRaw.map(String) : undefined,
        adId: id !== undefined ? String(id) : undefined,
        advertiserName: strOf(pick(n, ...K.adv)),
        headline: strOf(pick(n, ...K.head)),
        bodyText: strOf(pick(n, ...K.body)),
        ctaText: strOf(pick(n, ...K.cta)),
        landingPageUrl: urlOf(pick(n, ...K.link)),
        creativeUrl: image || "",
        images: image ? [image] : [],
        videos: video ? [{ hd: video, poster: image }] : [],
        mediaType: video ? "video" : "image",
        startDate: toIso(pick(n, ...K.start)),
        endDate: toIso(pick(n, ...K.end)),
        daysRunning: toNum(pick(n, ...K.days)),
        impressions: pick(n, ...K.imp),
        likes: toNum(pick(n, ...K.likes)),
        comments: toNum(pick(n, ...K.comments)),
        shares: toNum(pick(n, ...K.shares)),
        countries: pick(n, ...K.country),
        isActive: pick(n, ...K.active),
        spend: pick(n, ...K.spend),
        language: pick(n, ...K.lang),
        raw,
        sourceUrl: ctx.sourceUrl,
      },
      ctx
    );
  }

  // ── Nexscope (nexscope.ai API / web app) ──────────────────────────────────
  // TikTok ad search/detail (chuhaijiang-tiktok-ad-*) and creative search
  // (chuhaijiang-tiktok-creative-*). Image fields are provider objects of
  // unpublished shape, so accept url / url_list / urls / uri.
  const imgUrl = (v) =>
    isHttp(v) ? v : isObj(v) ? [v.url, v.uri, ...(v.url_list || v.urlList || v.urls || [])].find(isHttp) : undefined;
  const money = (v) => (isObj(v) ? v.value ?? v.amount ?? v : v);
  const isNexscopeAd = (n) => isStr(n.advertiser_name) && ("ad_url" in n || "ad_day_count" in n || "ad_title" in n || "advertiser_id" in n);
  const isNexscopeCreative = (n) => ("author_unique_id" in n || "author_nickname" in n) && ("video_desc" in n || "video_play_count" in n);

  // detail = matching item from chuhaijiang-tiktok-ad-detail (optional),
  // core = matching item from its "core" expansion (optional).
  function fromNexscopeTikTokAd(n, ctx = {}, detail = {}, core = {}) {
    const d = { ...n, ...detail };
    const cover = imgUrl(d.ad_cover);
    const videoId = d.video_id ? String(d.video_id) : undefined;
    const cat = [d.product_l1_category, d.product_l2_category, d.product_l3_category]
      .map((c) => (isObj(c) ? c.name || c.label : c))
      .filter(isStr);
    return finalize(
      {
        source: ctx.source || "nexscope",
        platform: "TikTok",
        adId: videoId || (d.id ? "nx-" + d.id : undefined), // video id = same key the extension uses → cross-source de-dup
        nexscopeAdId: d.id ? String(d.id) : undefined,
        videoId,
        productId: d.product_id ? String(d.product_id) : undefined,
        pageId: d.advertiser_id ? String(d.advertiser_id) : undefined,
        advertiserName: d.advertiser_name,
        pageUrl: d.advertiser_url,
        advertiserAvatar: imgUrl(d.advertiser_avatar),
        headline: d.ad_title || d.product_title,
        bodyText: d.ad_title,
        productTitle: d.product_title,
        ctaText: d.button_text,
        landingPageUrl: d.web_url,
        videoUrl: d.ad_url,
        creativeUrl: cover || "",
        videos: cover || d.ad_url ? [{ poster: cover, page: d.ad_url }] : [],
        mediaType: "video",
        durationSec: d.duration,
        daysRunning: toNum(core.core_ad_day_count ?? d.ad_day_count),
        views: toNum(core.core_video_play_count ?? d.video_play_count),
        likes: toNum(core.core_video_like_count ?? d.video_like_count),
        comments: toNum(core.core_video_comment_count),
        shares: toNum(core.core_video_share_count),
        saves: toNum(core.core_video_collect_count),
        engagementRate: d.video_engagement_rate,
        likeRate: d.video_like_rate,
        gmv: money(core.core_total_gmv ?? d.total_gmv),
        gpm30d: money(core.core_video_gpm_30d ?? d.video_gpm_30d),
        roas: core.core_ad_roas ?? d.ad_roas,
        maxCost: money(core.core_ad_maximum_cost ?? d.ad_maximum_cost),
        popularity: core.core_video_popularity ?? d.video_popularity,
        unitsSold: toNum(core.core_total_sc ?? d.total_sc),
        adType: core.core_ad_type,
        creativeId: core.core_creative_id,
        categories: cat.length ? cat : undefined,
        countries: ctx.country ? [String(ctx.country).toUpperCase()] : undefined,
        startDate: toIso(d.ad_create_time || d.create_time),
        lastUpdated: toIso(d.last_update_time),
        sourceUrl: ctx.sourceUrl,
      },
      ctx
    );
  }

  function fromNexscopeCreative(n, ctx = {}) {
    const videoId = n.video_id ? String(n.video_id) : undefined;
    const uid = n.author_unique_id;
    return finalize(
      {
        source: ctx.source || "nexscope",
        platform: "TikTok",
        adId: videoId || (n.id ? "nxc-" + n.id : undefined),
        videoId,
        productId: n.product_id ? String(n.product_id) : undefined,
        pageId: n.author_uid ? String(n.author_uid) : undefined,
        advertiserName: n.author_nickname || uid,
        advertiserHandle: uid,
        pageUrl: uid ? `https://www.tiktok.com/@${uid}` : undefined,
        advertiserAvatar: imgUrl(n.user_avatar),
        headline: clean(n.video_desc, 300),
        bodyText: n.video_desc,
        videoUrl: uid && videoId ? `https://www.tiktok.com/@${uid}/video/${videoId}` : undefined,
        creativeUrl: "",
        mediaType: "video",
        durationSec: n.video_duration,
        pageLikes: toNum(n.follower_cnt),
        views: toNum(n.video_play_count),
        likes: toNum(n.video_like_count),
        comments: toNum(n.video_comment_count),
        shares: toNum(n.video_share_count),
        saves: toNum(n.video_collect_count),
        engagementRate: n.video_engagement_rate,
        gmv: money(n.video_total_gmv),
        gmv30d: money(n.video_30d_gmv),
        gpm30d: money(n.video_30d_gpm),
        isAiGenerated: n.is_aigc_video,
        contentTags: n.content_tag_v2,
        contentIntent: n.content_intent,
        countries: n.country_code ? [String(n.country_code).toUpperCase()] : ctx.country ? [String(ctx.country).toUpperCase()] : undefined,
        postedAt: toIso(n.video_launch_time || n.video_date),
        sourceUrl: ctx.sourceUrl,
      },
      ctx
    );
  }

  // Shopify stores from shopify-store-query — not ads, but tells you which
  // stores run ads (advertiseCount + adLink) so you can spy on them.
  function fromNexscopeStore(s) {
    return {
      storeKey: "shopify:" + String(s.shopId || s.storeId || s.storeDomain || "").toLowerCase(),
      storeName: s.storeName,
      domain: s.storeDomain,
      url: s.storeLink,
      country: s.country,
      createdAt: s.createdTime,
      productCount: toNum(s.productNum),
      monthlyVisits: toNum(s.monthlyVisit),
      monthlyOrders: toNum(s.monthOrderNum),
      adCount: toNum(s.advertiseCount),
      adLibraryUrl: s.adLink,
      facebookUrl: s.facebookUrl,
      instagramUrl: s.instagramUrl,
      fbFollowers: toNum(s.fbFollowers),
      igFollowers: toNum(s.insFollowers),
      categories: s.categories,
      globalRank: toNum(s.globalRank),
      logo: s.logo,
      email: s.email,
      source: "nexscope",
    };
  }

  // ── Entry point: any parsed JSON doc → ads[] ──
  function extractAds(doc, ctx = {}) {
    const ads = [];
    const host = ctx.host || "";
    const isTT = /tiktok\.com$/.test(host);
    const isFB = /facebook\.com$|instagram\.com$/.test(host);
    const generic = !isTT && !isFB;
    walk(doc, (n) => {
      try {
        if (pick(n, "ad_archive_id", "adArchiveID") && isObj(n.snapshot)) {
          ads.push(fromAdLibrary(n, { ...ctx, source: generic ? ctx.source || "generic" : "fb_ad_library" }));
          return false;
        }
        if (isFB && isObj(n.sponsored_data)) {
          const a = fromFeedStory(n, ctx);
          if (a) ads.push(a);
          return false;
        }
        if (isTT && (n.id || n.aweme_id) && isObj(n.author) && isObj(n.video)) {
          if (isTikTokAd(n)) ads.push(fromTikTok(n, ctx));
          return false;
        }
        if (generic && isNexscopeAd(n)) {
          ads.push(fromNexscopeTikTokAd(n, { ...ctx, source: ctx.source || "nexscope" }));
          return false;
        }
        if (generic && isNexscopeCreative(n)) {
          ads.push(fromNexscopeCreative(n, { ...ctx, source: ctx.source || "nexscope" }));
          return false;
        }
        if (generic && looksLikeAd(n)) {
          ads.push(fromGeneric(n, ctx));
          return false;
        }
      } catch (e) {
        /* one bad node must not kill the batch */
      }
    });
    return ads;
  }

  const api = { parseJsonText, extractAds, fromAdLibrary, fromFeedStory, fromTikTok, fromGeneric, looksLikeAd, fromNexscopeTikTokAd, fromNexscopeCreative, fromNexscopeStore, isNexscopeAd, isNexscopeCreative, finalize, contentKey, unwrapLink, toNum, toIso, hash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AdSpyParsers = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
