import { v } from "convex/values";
import { internalAction, internalMutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./admin/helpers";
import { summarizeRun } from "./lib/importRuns";

// Daily imports run through here (see crons.ts) so every run leaves a row in
// importRuns: when it ran, what it brought in, and any errors such as an
// exhausted API credit balance. Admin → Data sources shows the latest run of
// each job. Before this, crons discarded the results and failures went unseen.

export const JOBS = ["adlibrary", "nexscopePricing", "nexscopeDiscovery", "nexscopeTikTok", "apify", "winninghunter", "metaAdLibrary", "pipispy", "aliexpressCosts", "transcripts"] as const;
const job = v.union(...JOBS.map((j) => v.literal(j)));
const KEEP_DAYS = 60;

export const run = internalAction({
  args: { job },
  handler: async (ctx, args): Promise<void> => {
    const startedAt = Date.now();
    let outcome: { result?: unknown; thrown?: unknown };
    try {
      outcome = { result: await runJob(ctx, args.job) };
    } catch (e) {
      outcome = { thrown: e };
    }
    await ctx.runMutation(internal.importRuns.record, { job: args.job, startedAt, finishedAt: Date.now(), ...summarizeRun(outcome) });
  },
});

async function runJob(ctx: ActionCtx, name: (typeof JOBS)[number]): Promise<unknown> {
  switch (name) {
    case "adlibrary":
      return await ctx.runAction(internal.adlibrary.sync.runSync, {});
    case "nexscopePricing":
      return await ctx.runAction(internal.nexscope.pricing.backfillProductPricing, {});
    case "nexscopeDiscovery":
      return await ctx.runAction(internal.nexscope.productDiscovery.discoverProducts, {});
    case "nexscopeTikTok":
      return await ctx.runAction(internal.nexscope.tiktokAds.dailyTikTokImport, {});
    case "apify":
      return await ctx.runAction(internal.apify.dailyApifyImport, {});
    case "winninghunter":
      return await ctx.runAction(internal.winninghunter.dailyImport, {});
    case "metaAdLibrary":
      return await ctx.runAction(internal.metaAdLibrary.dailyImport, {});
    case "transcripts":
      return await ctx.runAction(internal.transcripts.dailyTranscripts, {});
    case "aliexpressCosts":
      return await ctx.runAction(internal.aliexpress.dailyCosts, {});
    case "pipispy":
      if (!process.env.PIPISPY_API_KEY) return { notConfigured: "PIPISPY_API_KEY isn't set" };
      await ctx.runAction(internal.pipispy.dailyImport, {});
      return { started: 1 };
  }
}

export const record = internalMutation({
  args: {
    job,
    startedAt: v.number(),
    finishedAt: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("failed"), v.literal("skipped")),
    summary: v.string(),
    errors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("importRuns", args);
    // Keep the log small: drop this job's runs older than KEEP_DAYS.
    const old = await ctx.db
      .query("importRuns")
      .withIndex("by_job_started", (q) => q.eq("job", args.job).lt("startedAt", args.startedAt - KEEP_DAYS * 86_400_000))
      .take(50);
    for (const row of old) await ctx.db.delete("importRuns", row._id);
  },
});

// Admin: the latest run of each job, plus how many of its last 7 runs had problems.
export const latest = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const out = [];
    for (const name of JOBS) {
      const recent = await ctx.db
        .query("importRuns")
        .withIndex("by_job_started", (q) => q.eq("job", name))
        .order("desc")
        .take(7);
      out.push({
        job: name,
        last: recent[0] ?? null,
        problemsLast7: recent.filter((r) => r.status === "failed" || r.status === "partial").length,
      });
    }
    return out;
  },
});
