import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAdmin } from "./helpers";
import { adFields, upsertAd } from "../sources/links";

// Admin-only bulk import of ads pulled from an outside tool (e.g. the
// WinningHunter connector). Ads are keyed by externalId, so re-importing
// refreshes metrics instead of duplicating.
export const importAds = mutation({
  args: { ads: v.array(v.object(adFields)) },
  handler: async (ctx, args): Promise<{ created: number; updated: number }> => {
    await requireAdmin(ctx);
    if (args.ads.length > 100) throw new ConvexError({ code: "BAD_REQUEST", message: "Send at most 100 ads per batch" });
    let created = 0;
    let updated = 0;
    for (const ad of args.ads) {
      const r = await upsertAd(ctx, ad);
      if (r === "created") created++;
      else updated++;
    }
    return { created, updated };
  },
});
