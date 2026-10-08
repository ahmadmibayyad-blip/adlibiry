// DESIGN REFERENCE (Launch feature) — page generation: plan/quota checks, the launches table API,
// the myQuota public query used by the Launch dashboard header, and the internal generation+publish job.
// Integrated as three modules:
//   convex/launch.ts        — this file, part 1 (queries/mutations incl. myQuota)
//   convex/launchRun.ts     — part 2 (internal action: Claude writes the page, Shopify productSet publishes it)
//   convex/lib/launchCopy.ts — part 3 (pure, unit-tested: facts, claim rules, price, HTML, productSet input)
// Quota: Pro LAUNCH_MONTHLY_PRO/mo (default 10), Pro trial 2 total, agency unlimited.
// These mirror the integrated sources for the design record; edit the repo files, not these.

// ══════════════════════════════ convex/launch.ts ══════════════════════════════

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { stableToken } from "./lib/authIdentity";
import { effectivePlan, onProTrial } from "./lib/billing";
import { suggestPrice } from "./lib/launchCopy";

// ── Launch: winning product → product page in the user's Shopify store ──────
// start() checks the plan, the monthly quota and the product, then schedules
// launchRun.run (Claude writes the page and ad kit; we publish it with the
// Admin API). The page shows progress from the launches row.
// Quota: Pro 10 published pages a month (LAUNCH_MONTHLY_PRO), Pro trial 2 in
// total, agency plan and admins unlimited.

const PRO_MONTHLY = () => Math.max(0, Number(process.env.LAUNCH_MONTHLY_PRO ?? 10) || 10);
const TRIAL_TOTAL = 2;
const month = () => new Date().toISOString().slice(0, 7);

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

/** How many launches are left this month (null: unlimited); undefined when Launch isn't in the plan. */
async function allowance(ctx: QueryCtx, user: Doc<"users">): Promise<{ left: number | null; limit: number | null } | undefined> {
  const plan = effectivePlan(user);
  if (plan === "none") return undefined;
  if (plan === "agency") return { left: null, limit: null };
  if (onProTrial(user) && !user.subscriptionStatus) {
    const all = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", user._id)).collect();
    const used = all.reduce((s, r) => s + r.count, 0);
    return { left: Math.max(0, TRIAL_TOTAL - used), limit: TRIAL_TOTAL };
  }
  const row = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", user._id).eq("month", month())).unique();
  return { left: Math.max(0, PRO_MONTHLY() - (row?.count ?? 0)), limit: PRO_MONTHLY() };
}

/** The Launch dialog: store, quota, suggested price and the last launch of this product. */
export const prepare = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const product = await ctx.db.get("products", args.productId);
    if (!product) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const last = await ctx.db
      .query("launches")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id).eq("productId", args.productId))
      .order("desc")
      .first();
    return {
      allowed: (await allowance(ctx, user)) ?? null,
      store: store ? { shopDomain: store.shopDomain, shopName: store.shopName, locale: store.locale ?? "en", currency: store.currency ?? "USD" } : null,
      blocked: product.isBigBrand ? "This is a big-brand product. Selling it risks trademark claims and Meta and Shopify bans, so Launch is off for it." : null,
      suggested: suggestPrice({ price: product.price, cost: product.cost }),
      last: last ?? null,
    };
  },
});

export const start = mutation({
  args: {
    productId: v.id("products"),
    language: v.string(),
    tone: v.union(v.literal("friendly"), v.literal("premium"), v.literal("bold")),
    price: v.optional(v.number()),
    publish: v.union(v.literal("DRAFT"), v.literal("ACTIVE")),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const allowed = await allowance(ctx, user);
    if (!allowed) throw new ConvexError({ code: "PLAN_REQUIRED", message: "Launch is part of Pro. Start the 7-day trial or upgrade to use it." });
    if (allowed.left === 0) throw new ConvexError({ code: "LIMIT", message: `You've used your ${allowed.limit} launches${allowed.limit === TRIAL_TOTAL ? " on the trial" : " this month"}.` });
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new ConvexError({ code: "NOT_FOUND", message: "Product not found." });
    if (product.isBigBrand) throw new ConvexError({ code: "BLOCKED", message: "Launch is off for big-brand products (trademark risk)." });
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first (Settings → Shopify)." });
    const running = await ctx.db
      .query("launches")
      .withIndex("by_user_product", (q) => q.eq("userId", user._id).eq("productId", args.productId))
      .order("desc")
      .first();
    if (running && (running.status === "generating" || running.status === "publishing")) return { launchId: running._id };
    const price = args.price && args.price > 0 ? Math.round(args.price * 100) / 100 : suggestPrice(product).price;
    const launchId = await ctx.db.insert("launches", {
      userId: user._id,
      productId: args.productId,
      shopDomain: store.shopDomain,
      status: "generating",
      language: args.language.slice(0, 40) || "English",
      tone: args.tone,
      publish: args.publish,
      ...(price ? { price } : {}),
      createdAt: new Date().toISOString(),
    });
    await ctx.scheduler.runAfter(0, internal.launchRun.run, { launchId });
    return { launchId };
  },
});

export const get = query({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const l = await ctx.db.get("launches", args.launchId);
    return l && user && l.userId === user._id ? l : null;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
    return Promise.all(rows.map(async (l) => ({ ...l, product: await ctx.db.get("products", l.productId).then((p) => (p ? { title: p.title, imageUrl: p.imageUrl } : null)) })));
  },
});

/** The Launch dashboard header: plan, quota used/left, the connected store, totals. */
export const myQuota = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const allowed = await allowance(ctx, user);
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const rows = await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const now = month();
    return {
      plan: effectivePlan(user),
      // null when Launch isn't in the plan; left/limit null = unlimited.
      allowed: allowed ?? null,
      used: allowed && allowed.limit !== null && allowed.left !== null ? allowed.limit - allowed.left : null,
      store: store
        ? { shopDomain: store.shopDomain, shopName: store.shopName, viaApp: store.via === "oauth", locale: store.locale ?? "en", currency: store.currency ?? "USD" }
        : null,
      totals: {
        launches: rows.length,
        published: rows.filter((l) => l.status === "published").length,
        publishedThisMonth: rows.filter((l) => l.status === "published" && (l.finishedAt ?? l.createdAt).slice(0, 7) === now).length,
      },
    };
  },
});

// ── internal steps (launchRun.ts) ────────────────────────────────────────────

export const context = internalQuery({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args) => {
    const launch = await ctx.db.get("launches", args.launchId);
    if (!launch) return null;
    const product = await ctx.db.get("products", launch.productId);
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", launch.userId)).unique();
    if (!product || !store) return { launch, product: null, store: null, ads: [] };
    // The ads already selling it, best first: their angles shape the page and ad kit.
    const ads = (await Promise.all((product.adIds ?? []).slice(0, 30).map((id) => ctx.db.get("ads", id))))
      .filter((a): a is Doc<"ads"> => !!a)
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 3)
      .map((a) => ({ headline: a.headline, bodyText: a.bodyText, platform: a.platform, ...(a.spokenHook ? { spokenHook: a.spokenHook } : {}) }));
    return { launch, product, store, ads };
  },
});

export const setStatus = internalMutation({
  args: {
    launchId: v.id("launches"),
    status: v.string(),
    copy: v.optional(v.any()),
    shopifyProductId: v.optional(v.string()),
    adminUrl: v.optional(v.string()),
    storeUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { launchId, ...patch }) => {
    const launch = await ctx.db.get("launches", launchId);
    if (!launch) return;
    const done = patch.status === "published" || patch.status === "failed";
    await ctx.db.patch("launches", launchId, { ...Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)), ...(done ? { finishedAt: new Date().toISOString() } : {}) });
    if (patch.status === "published") {
      // Counts toward the quota only once it's live in the store.
      const row = await ctx.db.query("launchUsage").withIndex("by_user_month", (q) => q.eq("userId", launch.userId).eq("month", month())).unique();
      if (row) await ctx.db.patch("launchUsage", row._id, { count: row.count + 1 });
      else await ctx.db.insert("launchUsage", { userId: launch.userId, month: month(), count: 1 });
    }
  },
});


// ══════════════════════════════ convex/launchRun.ts ══════════════════════════════

"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import * as z from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { claudeClient } from "./lib/claudeClient";
import { claudeErrorMessage } from "./lib/claudeErrors";
import { LAUNCH_SYSTEM, cleanCopy, launchFacts, launchProductInput, type LaunchCopy } from "./lib/launchCopy";
import { decryptToken } from "./lib/shopifyOAuth";
import { SHOPIFY_API_VERSION } from "./lib/shopifyExport";

// The Launch job (convex/launch.ts start): Claude writes the page and ad kit
// from the product's facts and its winning ads, the claim rules clean it, and
// it's created in the user's store with productSet (and put on the Online
// Store when published as active). Progress and errors land on the launch row.

const MODEL = "claude-opus-5-5";

// No min/max in the schema (structured output); lengths are enforced in cleanCopy.
const CopySchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  benefits: z.array(z.string()),
  hook: z.string(),
  howItWorks: z.array(z.string()),
  whatsIncluded: z.array(z.string()),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  shippingReturns: z.string(),
  seo: z.object({ title: z.string(), description: z.string() }),
  adKit: z.array(z.object({ angle: z.string(), hook: z.string(), primaryText: z.string(), headline: z.string() })),
});

type Gql = { data?: Record<string, unknown>; errors?: { message: string }[] | string };

async function shopify(shop: string, token: string, query: string, variables?: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // Shopify rate limit or hiccup: wait and retry
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Gql;
    if (res.status === 401 || res.status === 403) throw new Error("Shopify refused access. Reconnect your store in Settings → Shopify.");
    if (!res.ok || body.errors) {
      const msg = typeof body.errors === "string" ? body.errors : (body.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Shopify: ${msg || `HTTP ${res.status}`}`.slice(0, 300));
    }
    return body.data ?? {};
  }
  throw new Error("Shopify is busy right now. Please try again in a minute.");
}

const PRODUCT_SET = `mutation Launch($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) {
    product { id handle onlineStorePreviewUrl }
    userErrors { field message }
  }
}`;

export const run = internalAction({
  args: { launchId: v.id("launches") },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "failed", error: error.slice(0, 300) });
    };
    const c = await ctx.runQuery(internal.launch.context, { launchId: args.launchId });
    if (!c) return;
    if (!c.product || !c.store) return fail("The product or the connected store is gone.");
    const { launch, product, store, ads } = c;

    // 1. Write the page and ad kit.
    let copy: LaunchCopy;
    try {
      if (!process.env.ANTHROPIC_API_KEY) return fail("The AI isn't set up yet (missing ANTHROPIC_API_KEY).");
      const message = await claudeClient().messages.parse({
        model: MODEL,
        max_tokens: 6000,
        system: LAUNCH_SYSTEM,
        messages: [{ role: "user", content: launchFacts(product, ads, { language: launch.language, tone: launch.tone, price: launch.price }) }],
        output_config: { effort: "low", format: zodOutputFormat(CopySchema) },
      });
      if (message.stop_reason === "refusal" || !message.parsed_output) return fail("The AI couldn't write this page. Try again or pick another product.");
      copy = cleanCopy(message.parsed_output as LaunchCopy).copy;
    } catch (e) {
      console.error("Launch: AI failed", e);
      return fail(e instanceof Anthropic.APIError ? claudeErrorMessage(e, false) : "The AI had a problem. Please try again.");
    }
    await ctx.runMutation(internal.launch.setStatus, { launchId: args.launchId, status: "publishing", copy });

    // 2. Create it in the store.
    try {
      const token = await decryptToken(store.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
      const input = launchProductInput(product, copy, { price: launch.price, cost: product.cost, status: launch.publish === "ACTIVE" ? "ACTIVE" : "DRAFT" });
      const data = (await shopify(store.shopDomain, token, PRODUCT_SET, { input })) as {
        productSet?: { product: { id: string; handle: string; onlineStorePreviewUrl?: string } | null; userErrors: { message: string }[] };
      };
      const created = data.productSet?.product;
      if (!created) return fail(`Shopify: ${(data.productSet?.userErrors ?? []).map((e) => e.message).join("; ") || "the product wasn't created"}`);
      const numericId = created.id.split("/").pop();
      let storeUrl = created.onlineStorePreviewUrl;
      if (launch.publish === "ACTIVE") {
        // Put it on the Online Store sales channel (needs the app's publications scope).
        try {
          const pubs = (await shopify(store.shopDomain, token, "{ publications(first: 20) { nodes { id name } } }")) as { publications?: { nodes: { id: string; name: string }[] } };
          const online = pubs.publications?.nodes.find((p) => /online store/i.test(p.name));
          if (online) {
            await shopify(store.shopDomain, token, "mutation P($id: ID!, $pub: ID!) { publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }", { id: created.id, pub: online.id });
            storeUrl = `https://${store.shopDomain}/products/${created.handle}`;
          }
        } catch (e) {
          console.warn("Launch: couldn't publish to the Online Store", e);
        }
      }
      await ctx.runMutation(internal.launch.setStatus, {
        launchId: args.launchId,
        status: "published",
        shopifyProductId: created.id,
        adminUrl: `https://${store.shopDomain}/admin/products/${numericId}`,
        ...(storeUrl ? { storeUrl } : {}),
      });
    } catch (e) {
      console.error("Launch: publish failed", e);
      return fail(e instanceof Error ? e.message : "Publishing to Shopify failed.");
    }
  },
});


// ══════════════════════════════ convex/lib/launchCopy.ts ══════════════════════════════

// Launch (convex/launch.ts): the facts we give the AI, the rules its copy
// must follow, the product page it becomes, and the Shopify product we create.
// Pure and unit-tested; no network.

export type LaunchCopy = {
  title: string;
  subtitle: string;
  benefits: string[];
  hook: string;
  howItWorks: string[];
  whatsIncluded: string[];
  faq: { q: string; a: string }[];
  shippingReturns: string;
  seo: { title: string; description: string };
  adKit: { angle: string; hook: string; primaryText: string; headline: string }[];
};

export type LaunchProduct = {
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  images?: string[];
  price?: number;
  cost?: number;
  supplierMatches?: { title: string; price: number; orders?: number; rating?: number }[];
};

export type LaunchAd = { headline: string; bodyText: string; spokenHook?: string; platform: string };

// ── price ────────────────────────────────────────────────────────────────────

/** Ends in .99, rounded to the nearest whole first: 27.4 → 26.99, 27.6 → 27.99. */
const charmPrice = (n: number) => Math.max(0.99, Math.round(n) - 0.01);

/**
 * Retail price from the real supplier cost (best AliExpress match + shipping is
 * already in `cost`): about 2.8×, never below 2.5×. Without a cost, the
 * product's market price. Returns the margin so the user sees it.
 */
export function suggestPrice(p: Pick<LaunchProduct, "price" | "cost">): { price?: number; cost?: number; marginPercent?: number } {
  if (p.cost && p.cost > 0) {
    let price = charmPrice(p.cost * 2.8);
    if (price < p.cost * 2.5) price = charmPrice(p.cost * 2.5 + 1);
    return { price, cost: p.cost, marginPercent: Math.round(((price - p.cost) / price) * 100) };
  }
  return p.price && p.price > 0 ? { price: Math.round(p.price * 100) / 100 } : {};
}

// ── facts for the AI ───────────────────────────────────────────────────────

const clip = (s: string | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

/** Only true things: the product, its real supplier signals and the ads already selling it. */
export function launchFacts(p: LaunchProduct, ads: LaunchAd[], opts: { language: string; tone: string; price?: number }): string {
  const best = p.supplierMatches?.[0];
  const lines = [
    `Product: ${p.title}`,
    `Niche: ${p.category}`,
    opts.price ? `Selling price: ${opts.price}` : "",
    p.description ? `Known description: ${clip(p.description, 800)}` : "",
    best?.orders ? `Supplier proof (real, may be quoted as "${best.orders.toLocaleString("en-US")}+ sold"): ${best.orders} orders in 30 days` : "",
    best?.rating ? `Supplier rating: ${best.rating}% positive` : "",
    ads.length ? "Ads already selling it (learn the angles, don't copy them word for word):" : "",
    ...ads.slice(0, 3).map((a, i) => `${i + 1}. [${a.platform}] ${clip(a.spokenHook || a.headline, 160)} — ${clip(a.bodyText, 300)}`),
    `Write in: ${opts.language}. Tone: ${opts.tone}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const LAUNCH_SYSTEM =
  "You write Shopify product pages for dropshipping stores. Use only the facts given: never invent reviews, ratings, " +
  "sales numbers, awards, certifications, discounts, guarantees or medical/health effects. Benefits must follow from what " +
  "the product is. Short sentences, concrete, no hype words like 'revolutionary' or 'miracle'. The FAQ answers real " +
  "buyer questions (sizing, use, care, shipping) without promising delivery times you don't know. The ad kit gives three " +
  "different angles learned from the ads already selling it. Return the requested JSON only.";

// ── claim rules ─────────────────────────────────────────────────────────────

// Claims that get ad accounts banned and break consumer law when you can't prove them.
const BANNED = [
  /\b(cures?|cured|heals?|treats?|prevents?|reverses?)\b[^.!?]*\b(disease|illness|pain|arthritis|diabetes|cancer|anxiety|depression|scoliosis|infection|insomnia)/i,
  /\b(fda|ce)[ -]?(approved|certified|cleared)\b/i,
  /\bclinically (proven|tested)\b/i,
  /\b(100%|guaranteed?)\s+(results?|effective|success|satisfaction)\b/i,
  /\bmoney[- ]back guarantee\b/i,
  /\b(#1|number one|best[- ]selling|world'?s best)\b/i,
  /\b(lose|losing)\s+\d+\s*(kg|lbs?|pounds)\b/i,
  /\b\d[\d,.]*\+?\s*(happy|satisfied)?\s*(customers|reviews|buyers)\b/i,
];

/** Drops sentences making claims we can't back up. Returns the cleaned text and how many were dropped. */
export function scrubClaims(text: string): { text: string; dropped: number } {
  let dropped = 0;
  const kept = (text.match(/[^.!?]+[.!?]*/g) ?? [text]).filter((sentence) => {
    const bad = BANNED.some((re) => re.test(sentence));
    if (bad) dropped++;
    return !bad;
  });
  return { text: kept.join("").replace(/\s{2,}/g, " ").trim(), dropped };
}

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Enforces lengths and counts, and the claim rules, on whatever the AI returned. */
export function cleanCopy(raw: LaunchCopy): { copy: LaunchCopy; dropped: number } {
  let dropped = 0;
  const s = (v: unknown, n: number) => {
    const r = scrubClaims(cut(v, n * 2));
    dropped += r.dropped;
    return r.text.slice(0, n);
  };
  const list = (arr: unknown, max: number, n: number) => (Array.isArray(arr) ? arr : []).map((x) => s(x, n)).filter(Boolean).slice(0, max);
  const copy: LaunchCopy = {
    title: s(raw.title, 70),
    subtitle: s(raw.subtitle, 140),
    benefits: list(raw.benefits, 5, 140),
    hook: s(raw.hook, 400),
    howItWorks: list(raw.howItWorks, 4, 200),
    whatsIncluded: list(raw.whatsIncluded, 6, 120),
    faq: (Array.isArray(raw.faq) ? raw.faq : [])
      .map((f) => ({ q: s(f?.q, 140), a: s(f?.a, 400) }))
      .filter((f) => f.q && f.a)
      .slice(0, 6),
    shippingReturns: s(raw.shippingReturns, 400),
    seo: { title: s(raw.seo?.title, 70), description: s(raw.seo?.description, 160) },
    adKit: (Array.isArray(raw.adKit) ? raw.adKit : [])
      .map((a) => ({ angle: s(a?.angle, 60), hook: s(a?.hook, 160), primaryText: s(a?.primaryText, 600), headline: s(a?.headline, 60) }))
      .filter((a) => a.hook && a.primaryText)
      .slice(0, 3),
  };
  return { copy, dropped };
}

// ── the page (product description: works on every theme) ────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function pageHtml(c: LaunchCopy, proof?: string): string {
  const parts: string[] = [];
  if (c.hook) parts.push(`<p><strong>${esc(c.hook)}</strong></p>`);
  if (c.benefits.length) parts.push(`<ul>${c.benefits.map((b) => `<li>✓ ${esc(b)}</li>`).join("")}</ul>`);
  if (proof) parts.push(`<p><em>${esc(proof)}</em></p>`);
  if (c.howItWorks.length) parts.push(`<h3>How it works</h3><ol>${c.howItWorks.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`);
  if (c.whatsIncluded.length) parts.push(`<h3>What's included</h3><ul>${c.whatsIncluded.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  if (c.faq.length) {
    parts.push(`<h3>FAQ</h3>${c.faq.map((f) => `<details><summary><strong>${esc(f.q)}</strong></summary><p>${esc(f.a)}</p></details>`).join("")}`);
  }
  if (c.shippingReturns) parts.push(`<h3>Shipping &amp; returns</h3><p>${esc(c.shippingReturns)}</p>`);
  return parts.join("\n");
}

/** A real, checkable sales signal from the supplier, or nothing. */
export function proofLine(p: LaunchProduct): string | undefined {
  const orders = p.supplierMatches?.[0]?.orders;
  return orders && orders >= 100 ? `${Math.floor(orders / 100) * 100}+ ordered from our supplier in the last 30 days` : undefined;
}

export const handleFor = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";

/** Shopify productSet input: the page, price and cost, images, SEO, and the copy as a metafield for our theme block. */
export function launchProductInput(p: LaunchProduct, c: LaunchCopy, o: { price?: number; cost?: number; status: "DRAFT" | "ACTIVE" }) {
  const images = [...new Set([p.imageUrl, ...(p.images ?? [])].filter((u) => /^https:\/\//.test(u)))].slice(0, 10);
  const title = c.title || p.title.slice(0, 255);
  return {
    title,
    handle: handleFor(title),
    descriptionHtml: pageHtml(c, proofLine(p)),
    productType: p.category,
    tags: ["AdSpy Launch", p.category],
    status: o.status,
    seo: { title: c.seo.title || title, description: c.seo.description || c.subtitle },
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        ...(o.price ? { price: o.price.toFixed(2) } : {}),
        ...(o.cost ? { inventoryItem: { cost: o.cost.toFixed(2), tracked: false } } : {}),
      },
    ],
    files: images.map((u, i) => ({ originalSource: u, contentType: "IMAGE", alt: i === 0 ? title.slice(0, 200) : `${title.slice(0, 180)} ${i + 1}` })),
    metafields: [{ namespace: "adspy", key: "page", type: "json", value: JSON.stringify({ subtitle: c.subtitle, benefits: c.benefits, faq: c.faq, proof: proofLine(p) ?? null }) }],
  };
}
