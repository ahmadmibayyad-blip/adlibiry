import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "./helpers";

// ── Admin: bulk product import from CSV (PiPiAds, Minea, Kalodata, own sheets) ─
// The browser parses the file and sends rows in batches of up to 200.
// Products are keyed by their store URL (query string removed), so importing
// the same file again updates metrics instead of creating duplicates.

const row = v.object({
  title: v.string(),
  imageUrl: v.string(),
  productUrl: v.string(),
  priceUsd: v.optional(v.number()),
  originalPrice: v.optional(v.string()), // e.g. "INR13999.0" as exported
  cost: v.optional(v.number()),
  category: v.string(),
  description: v.optional(v.string()),
  ads: v.optional(v.number()),
  likes: v.optional(v.number()),
  growthPercent: v.optional(v.number()),
  researchUrl: v.optional(v.string()), // e.g. the PiPiAds product page
  tags: v.optional(v.array(v.string())),
});

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${Math.round(n)}`;

// Honest 0-100 score from the export's own signals only (ads running, likes, growth).
function scoreFrom(ads?: number, likes?: number, growth?: number): number {
  const a = (Math.min(ads ?? 0, 50) / 50) * 100 * 0.45;
  const l = (Math.log10(1 + Math.max(0, likes ?? 0)) / 6) * 100 * 0.35; // 1M likes ≈ full
  const g = (Math.min(Math.max(growth ?? 0, 0), 100) / 100) * 100 * 0.2;
  return Math.max(1, Math.min(100, Math.round(a + Math.min(l, 35) + g)));
}

function trendFrom(growth?: number): string {
  if (growth === undefined) return "Unknown";
  if (growth >= 20) return "Rising";
  if (growth > -10) return "Stable";
  return "Declining";
}

export function productKey(url: string, title: string, image: string): string {
  const clean = (url || "").trim();
  if (clean) {
    try {
      const u = new URL(clean);
      return `csv:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return `csv:${title.trim().toLowerCase().slice(0, 120)}|${image.split("?")[0]}`;
}

export const importProducts = mutation({
  args: { rows: v.array(row), source: v.optional(v.string()), markWinners: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ created: number; updated: number; skipped: number }> => {
    await requireAdmin(ctx);
    if (args.rows.length > 200) throw new ConvexError({ code: "BAD_REQUEST", message: "Send at most 200 rows per batch" });
    const sourceTool = (args.source ?? "CSV").slice(0, 40);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const r of args.rows) {
      const title = r.title.trim().slice(0, 300);
      if (!title || !/^https?:\/\//.test(r.imageUrl)) {
        skipped += 1;
        continue;
      }
      const externalId = productKey(r.productUrl, title, r.imageUrl);
      const signals = [
        r.ads !== undefined ? `${r.ads} active ad${r.ads === 1 ? "" : "s"}` : "",
        r.likes ? `${compact(r.likes)} likes` : "",
        r.growthPercent !== undefined ? `${r.growthPercent.toFixed(1)}% growth` : "",
        r.originalPrice ? `listed at ${r.originalPrice}` : "",
      ].filter(Boolean);
      const description = (r.description?.trim() || `Imported from ${sourceTool}. ${signals.join(" · ")}.`).slice(0, 1000);
      const fields = {
        title,
        description,
        imageUrl: r.imageUrl,
        ...(r.priceUsd !== undefined && r.priceUsd > 0 ? { price: Math.round(r.priceUsd * 100) / 100, priceSource: "exact" } : {}),
        ...(r.cost !== undefined && r.cost > 0 ? { cost: Math.round(r.cost * 100) / 100 } : {}),
        category: r.category || "General",
        tags: [...new Set([r.category, sourceTool, "CSV import", ...(r.tags ?? [])].filter(Boolean))].slice(0, 8),
        aiScore: scoreFrom(r.ads, r.likes, r.growthPercent),
        trend: trendFrom(r.growthPercent),
        supplierUrl: r.productUrl || r.researchUrl || "",
      };

      const link = await ctx.db
        .query("syncLinks")
        .withIndex("by_kind_external", (q) => q.eq("kind", "product").eq("externalId", externalId))
        .unique();
      if (link) {
        const id = link.docId as Id<"products">;
        const existing = await ctx.db.get("products", id);
        if (existing) {
          await ctx.db.patch("products", id, fields);
          await ctx.db.patch("syncLinks", link._id, { lastSyncedAt: now });
          updated += 1;
          continue;
        }
        await ctx.db.delete("syncLinks", link._id);
      }
      const id = await ctx.db.insert("products", {
        ...fields,
        saturation: "Unknown",
        adExamples: [],
        isWinnerOfDay: !!args.markWinners,
        publishedAt: now,
        source: "csv_import",
      });
      await ctx.db.insert("syncLinks", { kind: "product", externalId, docId: id, source: "csv_import", lastSyncedAt: now });
      created += 1;
    }
    return { created, updated, skipped };
  },
});
