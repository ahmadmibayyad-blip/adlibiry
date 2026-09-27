// AdSpy Pro — network tap (runs in the PAGE world at document_start).
// Facebook, Ad Library, TikTok and adlibrary.com all load ad data as JSON over
// fetch/XHR. The DOM only shows a fraction of it (no ad IDs, start dates,
// video URLs, CTA, engagement...). This hook copies relevant JSON responses and
// hands them to the isolated content script via window.postMessage.
(() => {
  if (window.__adspyHooked) return;
  window.__adspyHooked = true;

  const HOST = location.hostname;
  const IS_FB = /(^|\.)facebook\.com$/.test(HOST);
  const IS_TT = /(^|\.)tiktok\.com$/.test(HOST);
  const MAX_LEN = 12 * 1024 * 1024;

  // Cheap pre-filter so we don't ship every response across the boundary.
  const FB_MARKERS = ["sponsored_data", "ad_archive_id", "adArchiveID"];
  const TT_MARKERS = ['"isAd":true', '"is_ad":true', '"adInfo"', '"ad_info"', '"adLabel"'];

  function wanted(url, text) {
    if (!text || text.length < 40 || text.length > MAX_LEN) return false;
    if (IS_FB) return FB_MARKERS.some((m) => text.includes(m));
    if (IS_TT) return TT_MARKERS.some((m) => text.includes(m));
    // adlibrary.com (and anything else we're injected into): any JSON-looking body.
    const c = text.trimStart()[0];
    return c === "{" || c === "[" || text.startsWith("for (;;);");
  }

  function emit(url, text) {
    try {
      if (!wanted(url, text)) return;
      window.postMessage({ __adspy: 1, url: String(url || ""), body: text }, "*");
    } catch (_) {}
  }

  const skipType = (ct) => /image|video|audio|font|octet-stream|css|javascript/i.test(ct || "");

  // ── fetch ──
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = (args[0] && args[0].url) || args[0];
        if (!skipType(res.headers.get("content-type"))) {
          res.clone().text().then((t) => emit(url, t)).catch(() => {});
        }
      } catch (_) {}
      return res;
    };
  }

  // ── XMLHttpRequest (Facebook GraphQL mostly uses XHR) ──
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  XHR.open = function (method, url, ...rest) {
    this.__adspyUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XHR.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const rt = this.responseType;
        if (rt === "" || rt === "text") emit(this.__adspyUrl, this.responseText);
        else if (rt === "json" && this.response) emit(this.__adspyUrl, JSON.stringify(this.response));
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };
})();
