import { ConvexError, v } from "convex/values";
import { httpAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authorizeUrl, encryptToken, missingStoreScopes, verifyQueryHmac, verifyWebhookHmac } from "./lib/shopifyOAuth";
import { normalizeShopDomain } from "./lib/shopifyExport";
import { fetchStoreInfo } from "./lib/shopifyStoreInfo";
import { appUrl } from "./lib/billing";
import { stableToken } from "./lib/authIdentity";

// ── The AdSpy Pro Shopify app: install by OAuth ─────────────────────────────
// Settings → "Connect Shopify" → Shopify asks the merchant to approve → back to
// /shopify/callback here → we exchange the code for an access token, encrypt
// it, and save the store on shopifyConnections (one per user, as before).
// Replaces pasted custom-app tokens, which merchants can't create since 2026.
// Env (Convex, Production): SHOPIFY_API_KEY, SHOPIFY_API_SECRET (the app's client
// ID and secret from the Shopify Dev Dashboard), SHOPIFY_TOKEN_KEY (32 random
// bytes, base64). The app's redirect URL is <CONVEX_SITE_URL>/shopify/callback.

const STATE_TTL_MS = 15 * 60_000;

async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", stableToken(identity))).unique();
}

const config = () => {
  const key = process.env.SHOPIFY_API_KEY?.trim();
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  const tokenKey = process.env.SHOPIFY_TOKEN_KEY?.trim();
  return key && secret && tokenKey ? { key, secret, tokenKey } : null;
};

/** Settings: is the app set up, and which store is connected (never the token). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    const c = user ? await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique() : null;
    return {
      appReady: !!config(),
      store: c
        ? {
            shopDomain: c.shopDomain,
            shopName: c.shopName,
            connectedAt: c.connectedAt,
            viaApp: c.via === "oauth",
            locale: c.locale,
            currency: c.currency,
            // App installs from before Full store lack its scopes (pasted tokens: unknown).
            missingStoreScopes: c.via === "oauth" ? missingStoreScopes(c.scopes ?? "") : [],
          }
        : null,
    };
  },
});

/** Step 1: the Shopify approval link for this store. */
export const startInstall = mutation({
  args: { shop: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await currentUser(ctx);
    if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const cfg = config();
    if (!cfg) throw new ConvexError({ code: "NOT_CONFIGURED", message: "The Shopify app isn't set up yet (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_TOKEN_KEY)." });
    const shop = normalizeShopDomain(args.shop);
    if (!shop) throw new ConvexError({ code: "BAD_REQUEST", message: "Enter your store's address, e.g. my-store.myshopify.com" });
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("shopifyOAuthStates", { state, userId: user._id, shop, createdAt: Date.now() });
    return { url: authorizeUrl(shop, cfg.key, `${process.env.CONVEX_SITE_URL}/shopify/callback`, state) };
  },
});

export const takeState = internalMutation({
  args: { state: v.string(), shop: v.string() },
  handler: async (ctx, args): Promise<Id<"users"> | null> => {
    const row = await ctx.db.query("shopifyOAuthStates").withIndex("by_state", (q) => q.eq("state", args.state)).unique();
    if (!row) return null;
    await ctx.db.delete("shopifyOAuthStates", row._id); // single use
    return row.shop === args.shop && Date.now() - row.createdAt < STATE_TTL_MS ? row.userId : null;
  },
});

export const saveInstall = internalMutation({
  args: {
    userId: v.id("users"),
    shopDomain: v.string(),
    shopName: v.string(),
    accessToken: v.string(),
    scopes: v.string(),
    currency: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // One store per account; the same store moves to whoever installs it last.
    for (const old of await ctx.db.query("shopifyConnections").withIndex("by_shop", (q) => q.eq("shopDomain", args.shopDomain)).collect()) {
      if (old.userId !== args.userId) await ctx.db.delete("shopifyConnections", old._id);
    }
    const existing = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique();
    // Reconnecting the same store keeps the pages Full store made there.
    const keep = existing?.shopDomain === args.shopDomain && existing.storePages ? { storePages: existing.storePages } : {};
    const row = { ...args, ...keep, via: "oauth", connectedAt: new Date().toISOString() };
    if (existing) await ctx.db.replace("shopifyConnections", existing._id, row);
    else await ctx.db.insert("shopifyConnections", row);
  },
});

const back = (outcome: string, detail?: string) => {
  const url = new URL(`${appUrl()}/dashboard/launch/shopify-callback`);
  url.searchParams.set("shopify", outcome);
  if (detail) url.searchParams.set("reason", detail.slice(0, 120));
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
};

/** Step 2: Shopify sends the merchant back here with a code. */
export const callback = httpAction(async (ctx, request) => {
  const cfg = config();
  if (!cfg) return back("error", "The Shopify app isn't set up yet.");
  const params = new URL(request.url).searchParams;
  const shop = normalizeShopDomain(params.get("shop") ?? "");
  if (!shop || !(await verifyQueryHmac(params, cfg.secret))) return back("error", "Shopify's reply couldn't be verified.");
  const state = params.get("state");
  // Installs started from Shopify's side (no state) can't be tied to an account yet.
  if (!state) return back("error", "Start the connection from AdSpy Pro: Settings → Connect Shopify.");
  const userId = await ctx.runMutation(internal.shopifyApp.takeState, { state, shop });
  if (!userId) return back("error", "That connection link expired. Please try again.");
  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: cfg.key, client_secret: cfg.secret, code: params.get("code") }),
    });
    const token = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string };
    if (!res.ok || !token.access_token) return back("error", `Shopify didn't give access (HTTP ${res.status}).`);
    const info = await fetchStoreInfo(shop, token.access_token);
    await ctx.runMutation(internal.shopifyApp.saveInstall, {
      userId,
      shopDomain: shop,
      shopName: info.name ?? shop,
      accessToken: await encryptToken(token.access_token, cfg.tokenKey),
      scopes: token.scope ?? "",
      ...(info.currency ? { currency: info.currency } : {}),
      ...(info.locale ? { locale: info.locale } : {}),
    });
    return back("connected");
  } catch (e) {
    console.error("Shopify install failed", e);
    return back("error", "Something went wrong talking to Shopify. Please try again.");
  }
});

export const forgetShop = internalMutation({
  args: { shopDomain: v.string() },
  handler: async (ctx, args) => {
    for (const c of await ctx.db.query("shopifyConnections").withIndex("by_shop", (q) => q.eq("shopDomain", args.shopDomain)).collect()) {
      await ctx.db.delete("shopifyConnections", c._id);
    }
  },
});

/**
 * Webhooks: app/uninstalled (forget the token at once) and Shopify's mandatory
 * privacy topics. We keep no customer data, so customers/data_request and
 * customers/redact need no action; shop/redact removes the store.
 */
export const webhook = httpAction(async (ctx, request) => {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  const raw = await request.text();
  if (!secret || !(await verifyWebhookHmac(raw, request.headers.get("X-Shopify-Hmac-Sha256"), secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const topic = request.headers.get("X-Shopify-Topic") ?? "";
  const shop = normalizeShopDomain(request.headers.get("X-Shopify-Shop-Domain") ?? "");
  if (shop && (topic === "app/uninstalled" || topic === "shop/redact")) await ctx.runMutation(internal.shopifyApp.forgetShop, { shopDomain: shop });
  return new Response(null, { status: 200 });
});

/** Expired install attempts (cron). */
export const pruneStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("shopifyOAuthStates").take(200);
    for (const s of old) if (Date.now() - s.createdAt > STATE_TTL_MS) await ctx.db.delete("shopifyOAuthStates", s._id);
  },
});

/** The connected store with its (still encrypted) token, for server-side calls. */
export const connectionFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", args.userId)).unique(),
});
