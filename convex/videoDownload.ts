import { ConvexError, v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { videoFileName } from "./lib/shopifyExport";
import { cookieHeader, tiktokVideoId, videoFileFromPage } from "./lib/tiktokVideo";

// ── Video download ──────────────────────────────────────────────────────────
// Ad videos live on other sites, so the browser can't save them directly.
// A signed-in user asks for a link (valid 10 minutes); GET /download/video
// streams that ad's video back as a file. Only stored ads.videoUrl values
// are fetched, never a URL from the request. TikTok ads have no stored file:
// we read the link from TikTok's public video page for that ad's video id.

const TTL_MS = 10 * 60_000;
const MAX_BYTES = 20_000_000; // HTTP action response limit; bigger files open the original link

export const downloadUrl = action({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<string> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to download videos." });
    const ad = await ctx.runQuery(internal.videoDownload.adForDownload, { adId: args.adId });
    if (!ad) throw new ConvexError({ code: "NOT_FOUND", message: "This ad has no video." });
    let source: { sourceUrl: string; cookie: string } | undefined;
    if (!ad.hasFile) {
      if (!ad.tiktokId) throw new ConvexError({ code: "NOT_FOUND", message: "This ad has no video." });
      source = await tiktokFile(ad.tiktokId);
    }
    const token = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internal.videoDownload.createToken, { token, adId: args.adId, userId: user._id, ...source });
    const site = process.env.CONVEX_SITE_URL ?? "";
    return `${site}/download/video?t=${token}`;
  },
});

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const NO_TIKTOK_FILE = "TikTok didn't give us the file for this video. Use “Not playing? Watch on TikTok” under the player.";

async function tiktokFile(id: string): Promise<{ sourceUrl: string; cookie: string }> {
  let res: Response;
  try {
    res = await fetch(`https://www.tiktok.com/@_/video/${id}`, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
    });
  } catch {
    throw new ConvexError({ code: "TIKTOK", message: NO_TIKTOK_FILE });
  }
  const sourceUrl = res.ok ? videoFileFromPage(await res.text()) : null;
  if (!sourceUrl) throw new ConvexError({ code: "TIKTOK", message: NO_TIKTOK_FILE });
  return { sourceUrl, cookie: cookieHeader(res.headers.get("set-cookie")) };
}

export const adForDownload = internalQuery({
  args: { adId: v.id("ads") },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.adId);
    return ad ? { hasFile: !!ad.videoUrl, tiktokId: tiktokVideoId(ad) } : null;
  },
});

export const createToken = internalMutation({
  args: { token: v.string(), adId: v.id("ads"), userId: v.id("users"), sourceUrl: v.optional(v.string()), cookie: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.adId);
    if (!ad?.videoUrl && !args.sourceUrl) throw new ConvexError({ code: "NOT_FOUND", message: "This ad has no video." });
    const now = Date.now();
    for (const old of await ctx.db.query("downloadTokens").withIndex("by_expires", (q) => q.lt("expiresAt", now)).take(50)) {
      await ctx.db.delete("downloadTokens", old._id);
    }
    await ctx.db.insert("downloadTokens", { ...args, expiresAt: now + TTL_MS });
  },
});

export const videoForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("downloadTokens").withIndex("by_token", (q) => q.eq("token", args.token)).unique();
    if (!row || row.expiresAt < Date.now()) return null;
    const ad = await ctx.db.get("ads", row.adId);
    const videoUrl = row.sourceUrl ?? ad?.videoUrl;
    return ad && videoUrl ? { videoUrl, cookie: row.cookie, fileName: videoFileName(ad.advertiserName) } : null;
  },
});

export const serveVideo = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const found = /^[a-f0-9]{32}$/.test(token) ? await ctx.runQuery(internal.videoDownload.videoForToken, { token }) : null;
  if (!found) return new Response("This download link has expired. Go back and click Download again.", { status: 410 });
  let upstream: Response;
  try {
    upstream = await fetch(found.videoUrl, {
      headers: found.cookie
        ? { "User-Agent": BROWSER_UA, Cookie: found.cookie, Referer: "https://www.tiktok.com/" }
        : { "User-Agent": "Mozilla/5.0 (compatible; AdSpyPro)" },
    });
  } catch {
    return Response.redirect(found.videoUrl, 302);
  }
  const size = Number(upstream.headers.get("content-length") ?? 0);
  // TikTok's links only work with its cookies, so redirecting there would fail too.
  if (found.cookie && (!upstream.ok || !upstream.body)) {
    return new Response("TikTok blocked this download. Go back and use “Not playing? Watch on TikTok” under the player.", { status: 502 });
  }
  if (!upstream.ok || !upstream.body || size > MAX_BYTES) return Response.redirect(found.videoUrl, 302);
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      "Content-Disposition": `attachment; filename="${found.fileName}"`,
      ...(size ? { "Content-Length": String(size) } : {}),
      "Cache-Control": "no-store",
    },
  });
});
