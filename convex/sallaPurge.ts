import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// PDPL retention for the Salla COD app, run daily (crons.ts). We never store customer names,
// numbers or addresses; what's left that points at a person is the keyed phone hash.
// - COD orders: phone hash, WhatsApp message id and error text removed after 90 days
//   (the stats keep working), the row deleted after a year.
// - Refusers (hashes that refused a confirmed order): deleted a year after the last refusal.
// - Webhook dedupe keys after 30 days, dashboard sessions once expired.

const DAY = 24 * 60 * 60 * 1000;
export const SCRUB_AFTER_MS = 90 * DAY;
export const DELETE_AFTER_MS = 365 * DAY;
export const REFUSER_AFTER_MS = 365 * DAY;
export const DEDUPE_AFTER_MS = 30 * DAY;
const BATCH = 300;

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let more = false;

    const toScrub = await ctx.db
      .query("sallaCodOrders")
      .withIndex("by_scrubbed_created", (q) => q.eq("scrubbedAt", undefined).lt("createdAt", now - SCRUB_AFTER_MS))
      .take(BATCH);
    for (const o of toScrub) {
      await ctx.db.patch("sallaCodOrders", o._id, { phoneHash: undefined, waMessageId: undefined, lastError: undefined, scrubbedAt: now });
    }
    more ||= toScrub.length === BATCH;

    const old = await ctx.db.query("sallaCodOrders").withIndex("by_created", (q) => q.lt("createdAt", now - DELETE_AFTER_MS)).take(BATCH);
    for (const o of old) await ctx.db.delete("sallaCodOrders", o._id);
    const deleted = old.length;
    more ||= deleted === BATCH;

    const refusers = await ctx.db.query("sallaRefusers").withIndex("by_last", (q) => q.lt("lastAt", now - REFUSER_AFTER_MS)).take(BATCH);
    for (const r of refusers) await ctx.db.delete("sallaRefusers", r._id);
    more ||= refusers.length === BATCH;

    const keys = await ctx.db.query("sallaWebhookEvents").withIndex("by_received", (q) => q.lt("receivedAt", now - DEDUPE_AFTER_MS)).take(BATCH);
    for (const k of keys) await ctx.db.delete("sallaWebhookEvents", k._id);
    more ||= keys.length === BATCH;

    const sessions = await ctx.db.query("sallaSessions").withIndex("by_expires", (q) => q.lt("expiresAt", now)).take(BATCH);
    for (const s of sessions) await ctx.db.delete("sallaSessions", s._id);
    more ||= sessions.length === BATCH;

    if (more) await ctx.scheduler.runAfter(0, internal.sallaPurge.run, {});
    return { scrubbed: toScrub.length, deleted, refusers: refusers.length, keys: keys.length, sessions: sessions.length };
  },
});
