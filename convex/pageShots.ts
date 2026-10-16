"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { productUrl } from "./lib/productImport";
import { MAX_SHOT_BYTES, shotInput } from "./lib/screenshots";

// "Paste a link" for Screenshot to page and Launch → Match a screenshot: Apify's own screenshot actor
// (apify/screenshot-url, free apart from about $0.003 of compute) opens the page in a browser and takes
// a full-page PNG; it goes back to the browser, which cuts it into parts like an uploaded screenshot.

const ACTOR = "apify~screenshot-url";

export const take = action({
  args: { url: v.string() },
  handler: async (ctx, args): Promise<{ data: string; mediaType: string; host: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const raw = args.url.trim();
    const u = productUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u) throw new ConvexError({ code: "BAD_LINK", message: "Paste a page's full address, like https://store.com" });
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new ConvexError({ code: "NOT_SET_UP", message: "Screenshots from links aren't switched on yet (APIFY_TOKEN). Upload a screenshot instead." });
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const claim = await ctx.runMutation(internal.screenPages.claimShot, { token: stableToken(identity), host });
    if (!claim.ok) throw new ConvexError({ code: "LIMIT", message: claim.message });

    const failed = `We couldn't take a screenshot of ${host}. Check the link, or upload a screenshot instead.`;
    let shotUrl: string | undefined;
    try {
      const q = new URLSearchParams({ token, timeout: "150", memory: "2048" });
      const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shotInput(u.toString())),
        signal: AbortSignal.timeout(170_000),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        console.warn("Page screenshot: Apify", res.status, text);
        if (/hard limit|usage limit|insufficient|credit/i.test(text)) {
          throw new ConvexError({ code: "BUDGET", message: "Screenshots from links have used this month's credit. Upload a screenshot instead." });
        }
        throw new ConvexError({ code: "SHOT_FAILED", message: failed });
      }
      const items = (await res.json().catch(() => null)) as { screenshotUrl?: unknown }[] | null;
      // A run that ran out of time answers with no items.
      shotUrl = typeof items?.[0]?.screenshotUrl === "string" ? items[0].screenshotUrl : undefined;
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      console.warn("Page screenshot failed", e);
      throw new ConvexError({ code: "SHOT_FAILED", message: failed });
    }
    // The run's storage isn't public: the token reads it.
    if (!shotUrl?.startsWith("https://api.apify.com/")) throw new ConvexError({ code: "SHOT_FAILED", message: failed });
    const img = await fetch(shotUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    const type = img?.headers.get("content-type") ?? "";
    if (!img?.ok || !/^image\/(png|jpeg|webp)/.test(type)) throw new ConvexError({ code: "SHOT_FAILED", message: failed });
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length > MAX_SHOT_BYTES) {
      throw new ConvexError({ code: "TOO_LARGE", message: `${host}'s page is too long for one screenshot. Upload a screenshot of the part you want.` });
    }
    return { data: bytes.toString("base64"), mediaType: type.split(";")[0], host };
  },
});
