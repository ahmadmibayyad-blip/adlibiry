"use node";

import escapeHtml from "escape-html";
import { Hercules } from "./lib/herculesShim";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const hercules = new Hercules({ apiKey: process.env.HERCULES_API_KEY, apiVersion: "2025-12-09" });

// IMPORTANT: this must be a verified sender email/domain (Emails → Verify email in the
// Hercules dashboard) before the daily digest cron can actually deliver mail.
const DIGEST_SENDER = "AdSpy Pro <alerts@adspypro.app>";

function renderDigestHtml(winners: Doc<"products">[], appUrl: string): string {
  const rows = winners
    .map(
      (p) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #222;">
            <img src="${escapeHtml(p.imageUrl)}" width="56" height="56" style="border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:12px;" />
            <span style="font-size:15px;font-weight:600;color:#fff;">${escapeHtml(p.title)}</span>
            <div style="font-size:13px;color:#9aa;margin-top:2px;">AI score ${p.aiScore}/100 · ${escapeHtml(p.category)}</div>
          </td>
        </tr>`
    )
    .join("");

  return `
    <div style="background:#0a0a12;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="max-width:480px;margin:0 auto;">
        <h1 style="color:#fff;font-size:20px;margin-bottom:4px;">Today's Winning Products</h1>
        <p style="color:#9aa;font-size:13px;margin-bottom:20px;">Your daily AdSpy Pro digest</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        <a href="${escapeHtml(appUrl)}/dashboard/products" style="display:inline-block;margin-top:20px;background:#1fbf6b;color:#0a0a12;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">
          View all winners
        </a>
        <p style="color:#666;font-size:11px;margin-top:24px;">
          You're receiving this because you enabled the daily digest in AdSpy Pro alert settings.
        </p>
      </div>
    </div>`;
}

export const sendDailyDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const recipients: { email: string; userId: string }[] = [];
    for (let cursor: string | null = null, done = false; !done; ) {
      const page: { recipients: { email: string; userId: string }[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
        internal.emailDigest.getDigestRecipients,
        { cursor },
      );
      recipients.push(...page.recipients);
      cursor = page.continueCursor;
      done = page.isDone;
    }
    if (recipients.length === 0) return { sent: 0 };

    const winners: Doc<"products">[] = await ctx.runQuery(internal.emailDigest.getTodaysWinners);
    if (winners.length === 0) return { sent: 0 };

    const appUrl = process.env.CONVEX_SITE_URL?.replace(".convex.site", "") ?? "";

    let sent = 0;
    for (const recipient of recipients) {
      try {
        await hercules.email.send({
          from: DIGEST_SENDER,
          to: recipient.email,
          subject: `${winners.length} new winning products today`,
          html: renderDigestHtml(winners, appUrl),
        });
        sent++;
      } catch (error) {
        console.error(`Failed to send digest to ${recipient.email}:`, error);
      }
    }
    return { sent };
  },
});

export const sendTestDigest = internalAction({
  args: { to: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const winners: Doc<"products">[] = await ctx.runQuery(internal.emailDigest.getTodaysWinners);
    const appUrl = process.env.CONVEX_SITE_URL?.replace(".convex.site", "") ?? "";
    await hercules.email.send({
      from: DIGEST_SENDER,
      to: args.to,
      subject: "AdSpy Pro — Test digest",
      html: renderDigestHtml(winners, appUrl),
    });
    return { success: true };
  },
});
