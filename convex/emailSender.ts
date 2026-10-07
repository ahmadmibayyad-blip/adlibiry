"use node";

import { Hercules } from "./lib/herculesShim";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { appUrl as siteUrl } from "./lib/billing";
import { pickDigestWinners, renderDigestHtml, type DigestWinner } from "./lib/digest";

const hercules = new Hercules({ apiKey: process.env.HERCULES_API_KEY, apiVersion: "2025-12-09" });

// The domain must be verified in Resend (Domains) before mail is delivered;
// EMAIL_FROM overrides this sender.
const DIGEST_SENDER = "AdSpy Pro <alerts@adspypro.net>";

// ── Morning digest ──────────────────────────────────────────────────────────
// Hourly (crons.ts) and at the end of the daily pipeline: everyone whose
// local time is 8:00 gets their top 5 new winners (in their niches) and the
// day's alerts, once a day, with an unsubscribe link and a one-click
// List-Unsubscribe header. One page of recipients per run; the next page is
// scheduled, so a long list can't run past the action time limit.

export const sendMorningDigests = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())), nowMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ sent: number; skipped: number }> => {
    const nowMs = args.nowMs ?? Date.now();
    const page = await ctx.runQuery(internal.digest.dueRecipients, { cursor: args.cursor ?? null, nowMs });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.emailSender.sendMorningDigests, { cursor: page.cursor, nowMs });
    if (!page.due.length) return { sent: 0, skipped: 0 };

    const rows: DigestWinner[] = await ctx.runQuery(internal.digest.winnerRows, {});
    const appUrl = siteUrl();
    const site = process.env.CONVEX_SITE_URL ?? "";
    const sinceIso = new Date(nowMs - 86_400_000).toISOString();
    let sent = 0;
    let skipped = 0;
    for (const r of page.due) {
      const winners = pickDigestWinners(rows, r.niches, r.day);
      const alerts = await ctx.runQuery(internal.digest.recentAlerts, { userId: r.userId, sinceIso });
      if (!winners.length && !alerts.length) {
        // Nothing new today: no empty email, and no new check until tomorrow.
        await ctx.runMutation(internal.digest.markSent, { userId: r.userId, day: r.day });
        skipped++;
        continue;
      }
      const token = r.token ?? (await ctx.runMutation(internal.digest.ensureToken, { userId: r.userId }));
      const unsubscribeUrl = `${appUrl}/unsubscribe?token=${token}`;
      try {
        await hercules.email.send({
          from: DIGEST_SENDER,
          to: r.email,
          subject: winners.length ? `${winners.length} new winning product${winners.length === 1 ? "" : "s"} this morning` : "Your AdSpy Pro alerts",
          html: renderDigestHtml({ winners, alerts, appUrl, unsubscribeUrl, niches: r.niches }),
          headers: {
            "List-Unsubscribe": `<${site ? `${site}/email/unsubscribe?token=${token}` : unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        await ctx.runMutation(internal.digest.markSent, { userId: r.userId, day: r.day });
        sent++;
      } catch (error) {
        console.error(`Failed to send digest to user ${r.userId}:`, error);
      }
    }
    return { sent, skipped };
  },
});
