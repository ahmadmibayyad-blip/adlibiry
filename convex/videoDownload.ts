import { ConvexError, v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { videoFileName } from "./lib/shopifyExport";

// ── Video download ──────────────────────────────────────────────────────────
// Ad videos live on other sites, so the browser can't save them directly.
// A signed-in user asks for a link (valid 10 minutes); GET /download/video
// streams that ad's video back as a file. Only stored ads.videoUrl values
// are fetched, never a URL from the request.

const TTL_MS = 10 * 60_000;
const MAX_BYTES = 20_000_000; // HTTP action response limit; bigger files open the original link

export const downloadUrl = action({
  args: { adId: v.id("ads") },
  handler: async (ctx, args): Promise<string> => {
    const user = await ctx.runQuery(internal.users.getCurrentUserInternal, {});
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to download videos." });
    const token = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internal.videoDownload.createToken, { token, adId: args.adId, userId: user._id });
    const site = process.env.CONVEX_SITE_URL ?? "";
    return `${site}/download/video?t=${token}`;
  },
});

export const createToken = internalMutation({
  args: { token: v.string(), adId: v.id("ads"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const ad = await ctx.db.get("ads", args.adId);
    if (!ad?.videoUrl) throw new ConvexError({ code: "NOT_FOUND", message: "This ad has no video." });
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
    return ad?.videoUrl ? { videoUrl: ad.videoUrl, fileName: videoFileName(ad.advertiserName) } : null;
  },
});

export const serveVideo = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const found = /^[a-f0-9]{32}$/.test(token) ? await ctx.runQuery(internal.videoDownload.videoForToken, { token }) : null;
  if (!found) return new Response("This download link has expired. Go back and click Download again.", { status: 410 });
  let upstream: Response;
  try {
    upstream = await fetch(found.videoUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AdSpyPro)" } });
  } catch {
    return Response.redirect(found.videoUrl, 302);
  }
  const size = Number(upstream.headers.get("content-length") ?? 0);
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
