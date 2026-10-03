import * as z from "zod/v4";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// Read-only data tools shared by the in-app AI assistant (convex/assistant.ts)
// and the MCP server customers connect from their own AI apps (convex/mcp.ts).
// Each returns compact JSON text built from the same queries the pages use.

type Ctx = Pick<ActionCtx, "runQuery">;

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

const adSearchInput = z.object({
  search: z.string().optional().describe("Words that appear in the ad text, e.g. 'posture corrector'"),
  niche: z.string().optional().describe("Exact niche name from list_niches, e.g. 'Beauty'"),
  platform: z.enum(["Facebook", "Instagram", "TikTok"]).optional(),
  country: z.string().optional().describe("ISO country code, e.g. 'US', 'DK'"),
  mediaType: z.enum(["video", "image", "carousel"]).optional(),
  minDaysRunning: z.number().optional().describe("Only ads running at least this many days (a sign they are profitable)"),
  sort: z.enum(["newest", "score", "mostLiked", "longestRunning", "impressions", "comments"]).optional(),
  limit: z.number().min(1).max(15).optional().describe("How many ads to return (default 8)"),
});

export const searchAdsTool = {
  name: "search_ads",
  description:
    "Search the ad library (Facebook, Instagram, TikTok ads). Returns up to `limit` ads with advertiser, headline, text, niche, likes, views, days running, estimated spend, score and landing page. Use `search` for words in the ad text; leave it empty to browse by niche/platform and sort.",
  inputSchema: adSearchInput,
  async run(ctx: Ctx, { limit, search, ...filters }: z.infer<typeof adSearchInput>): Promise<string> {
    const result = await ctx.runQuery(internal.ads.listInternal, {
      paginationOpts: { numItems: limit ?? 8, cursor: null },
      ...filters,
      ...(search?.trim() ? { search: search.trim() } : {}),
    });
    return JSON.stringify(
      result.page.map((a) => ({
        advertiser: a.advertiserName,
        platform: a.platform,
        country: a.country,
        niche: a.niche,
        headline: clip(a.headline, 160),
        text: clip(a.bodyText, 400),
        mediaType: a.mediaType,
        likes: a.likes,
        views: a.views,
        comments: a.comments,
        daysRunning: a.daysRunning,
        spendEstimate: a.spendEstimate,
        score: a.aiScore,
        cta: a.ctaText,
        landingPage: a.landingPageUrl || undefined,
      })),
    );
  },
};

const productSearchInput = z.object({
  search: z.string().optional().describe("Words in the product title, e.g. 'dog bed'"),
  category: z.string().optional().describe("Exact niche/category name from list_niches"),
  maxPrice: z.number().optional().describe("Max selling price in USD"),
  minMargin: z.number().min(0).max(100).optional().describe("Minimum margin in percent"),
  trend: z.enum(["Rising", "Stable", "Declining"]).optional(),
  winnerOfDayOnly: z.boolean().optional().describe("Only today's picked winners"),
  sort: z.enum(["newest", "score", "ads", "likes", "growth", "margin"]).optional(),
  limit: z.number().min(1).max(15).optional().describe("How many products to return (default 8)"),
});

export const searchProductsTool = {
  name: "search_products",
  description:
    "Search the winning-products database. Returns up to `limit` products with id, title, category, price, cost, margin, score, trend, saturation, ads running and likes. Use `search` for words in the product title.",
  inputSchema: productSearchInput,
  async run(ctx: Ctx, { limit, search, ...filters }: z.infer<typeof productSearchInput>): Promise<string> {
    const result = await ctx.runQuery(internal.products.listInternal, {
      paginationOpts: { numItems: limit ?? 8, cursor: null },
      ...filters,
      ...(search?.trim() ? { search: search.trim() } : {}),
    });
    return JSON.stringify(
      result.page.map((p) => ({
        id: p._id,
        title: clip(p.title, 160),
        category: p.category,
        price: p.price,
        cost: p.cost,
        marginPercent: p.price && p.cost !== undefined ? Math.round(((p.price - p.cost) / p.price) * 100) : undefined,
        priceIsEstimate: p.priceSource === "estimated_market" || undefined,
        score: p.aiScore,
        trend: p.trend,
        saturation: p.saturation,
        adsRunning: p.adsCount,
        likes: p.likes,
        growthPercent: p.growthPercent,
        winnerOfDay: p.isWinnerOfDay || undefined,
      })),
    );
  },
};

export const listNichesTool = {
  name: "list_niches",
  description: "List the niche names used for ads and products, to pass as `niche` or `category` in the other tools.",
  inputSchema: z.object({}),
  async run(ctx: Ctx): Promise<string> {
    return JSON.stringify(await ctx.runQuery(internal.ads.getNichesInternal, {}));
  },
};

// Caps a search tool's `limit` at the customer's per-list result limit
// (free and trial accounts), so the assistant and agents can't return more
// rows than the app shows. null: no cap.
export function capLimit<T extends { limit?: number }>(input: T, max: number | null): T {
  return max === null ? input : { ...input, limit: Math.min(input.limit ?? 8, max) };
}

export const DATA_TOOLS = [searchAdsTool, searchProductsTool, listNichesTool] as const;
