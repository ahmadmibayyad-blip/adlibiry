"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { claudeClient } from "./lib/claudeClient";
import { claimAiRequest } from "./lib/aiQuota";
import { MAX_NOTES, SCREEN_PAGE_SYSTEM, createPrompt, editPrompt, extractHtml } from "./lib/screenPage";
import { partsNote, screenshotProblem } from "./lib/screenshots";

// Screenshot to page: create() keeps the screenshot parts in Convex storage and starts run(), which asks
// Claude for the page; edit() asks for a change to a page. The page shows progress from screenPages.get.

const imageArg = v.object({ data: v.string(), mediaType: v.string() });

async function signedIn(ctx: ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
  return stableToken(identity);
}

export const create = action({
  args: { images: v.array(imageArg), notes: v.optional(v.string()), productIds: v.optional(v.array(v.id("importedProducts"))) },
  handler: async (ctx, args): Promise<{ id: Id<"screenPages"> }> => {
    const problem = screenshotProblem(args.images);
    if (problem) throw new ConvexError({ code: "BAD_REQUEST", message: problem });
    if (!process.env.ANTHROPIC_API_KEY) throw new ConvexError({ code: "NOT_CONFIGURED", message: "AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    const pre = await ctx.runQuery(internal.screenPages.before, { token: await signedIn(ctx) });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (pre.message) throw new ConvexError({ code: "LIMIT", message: pre.message });
    await claimAiRequest(ctx);
    const imageIds = await Promise.all(args.images.map((p) => ctx.storage.store(new Blob([Buffer.from(p.data, "base64")], { type: p.mediaType }))));
    const notes = args.notes?.trim().slice(0, MAX_NOTES);
    const id = await ctx.runMutation(internal.screenPages.insert, {
      userId: pre.userId,
      imageIds,
      ...(notes ? { notes } : {}),
      ...(args.productIds?.length ? { productIds: args.productIds } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.screenPagesAi.run, { id });
    return { id };
  },
});

export const edit = action({
  args: { id: v.id("screenPages"), change: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const change = args.change.trim().slice(0, MAX_NOTES);
    if (!change) throw new ConvexError({ code: "BAD_REQUEST", message: "Say what to change." });
    const pre = await ctx.runQuery(internal.screenPages.before, { token: await signedIn(ctx) });
    if (!pre) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    if (pre.message) throw new ConvexError({ code: "LIMIT", message: pre.message });
    await claimAiRequest(ctx);
    const refused = await ctx.runMutation(internal.screenPages.startEdit, { id: args.id, userId: pre.userId, change });
    if (refused) throw new ConvexError({ code: "BAD_REQUEST", message: refused });
    await ctx.scheduler.runAfter(0, internal.screenPagesAi.run, { id: args.id });
  },
});

/** Makes the page (or applies the pending change) and saves it; a failure is saved on the page. */
export const run = internalAction({
  args: { id: v.id("screenPages") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.screenPages.context, { id: args.id });
    if (!c || c.page.status !== "making") return;
    const { page, products, isAdmin } = c;
    try {
      const images: Anthropic.ImageBlockParam[] = [];
      for (const id of page.imageIds) {
        const blob = await ctx.storage.get(id);
        if (!blob) continue;
        const type = /^image\/(jpeg|png|webp)$/.test(blob.type) ? (blob.type as "image/jpeg") : "image/jpeg";
        images.push({ type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await blob.arrayBuffer()).toString("base64") } });
      }
      if (!images.length) {
        await ctx.runMutation(internal.screenPages.fail, { id: args.id, error: "The screenshot is gone. Upload it again." });
        return;
      }
      const note = partsNote(images.length);
      const prompt = page.pending && page.html ? editPrompt(page.html, page.pending, note) : createPrompt(note, page.notes, products);
      // About 450 s at most for 16k tokens: inside the SDK's and Convex's 10-minute limits.
      const message = await claudeClient().messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        system: SCREEN_PAGE_SYSTEM,
        messages: [{ role: "user", content: [...images, { type: "text", text: prompt }] }],
        output_config: { effort: "low" },
      });
      const answer = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const html = message.stop_reason === "refusal" ? null : extractHtml(answer);
      if (!html) {
        await ctx.runMutation(internal.screenPages.fail, { id: args.id, error: "The AI didn't return a page. Try again, or try a clearer screenshot." });
        return;
      }
      await ctx.runMutation(internal.screenPages.finish, { id: args.id, html });
    } catch (error) {
      console.error("Screenshot to page failed", error);
      const reason = error instanceof Anthropic.APIError ? claudeErrorMessage(error, isAdmin) : "Something went wrong while making the page. Try again.";
      await ctx.runMutation(internal.screenPages.fail, { id: args.id, error: reason });
    }
  },
});
