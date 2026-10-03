import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// Every action that calls a paid AI model goes through this first: the caller
// must be signed in, and each request counts toward the same daily AI limit as
// the assistant, agents and niche reports (ASSISTANT_DAILY_LIMIT, default 30;
// admins are not limited).
export async function claimAiRequest(ctx: ActionCtx): Promise<void> {
  const limit = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT ?? 30) || 30);
  const claim = await ctx.runMutation(internal.assistantUsage.claimMessage, { limit });
  if (!claim.signedIn) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to use AI tools." });
  if (!claim.allowed) throw new ConvexError({ code: "LIMIT", message: `You've used all ${limit} AI requests for today. Come back tomorrow.` });
}
