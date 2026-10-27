import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptToken, encryptToken } from "./lib/shopifyOAuth";
import { orderGql, ShopifyError } from "./lib/shopifyOrderApi";
import { ISTILAM_API_VERSION } from "./lib/shopifyCod";

// Istilam for Shopify: the shop's access token. Managed installation (scopes in
// shopify-istilam/shopify.app.toml), so there's no OAuth redirect: the first time the page opens
// inside Shopify admin, its id token is exchanged for an expiring offline token (+ refresh token,
// 90 days), stored encrypted with SHOPIFY_TOKEN_KEY. Convex env: SHOPIFY_ISTILAM_CLIENT_ID,
// SHOPIFY_ISTILAM_CLIENT_SECRET. Nothing here touches AdSpy Pro's own Shopify app.

const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const LOCK_MS = 30 * 1000;

export class NeedsNewSession extends Error {}

function credentials() {
  const clientId = process.env.SHOPIFY_ISTILAM_CLIENT_ID?.trim();
  const secret = process.env.SHOPIFY_ISTILAM_CLIENT_SECRET?.trim();
  if (!clientId || !secret) throw new Error("SHOPIFY_ISTILAM_CLIENT_ID / SHOPIFY_ISTILAM_CLIENT_SECRET aren't set");
  return { clientId, secret };
}

function tokenKey(): string {
  const key = process.env.SHOPIFY_TOKEN_KEY?.trim();
  if (!key) throw new Error("SHOPIFY_TOKEN_KEY isn't set, so the shop's token can't be stored");
  return key;
}

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };

async function tokenRequest(shop: string, params: Record<string, string>): Promise<TokenAnswer & { status: number }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenAnswer;
  return { ...data, status: res.status };
}

async function encrypted(data: TokenAnswer) {
  const key = tokenKey();
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== "number") throw new Error("Shopify: the token answer is missing fields");
  return {
    tokenEnc: await encryptToken(data.access_token, key),
    refreshTokenEnc: await encryptToken(data.refresh_token, key),
    tokenExpiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope,
  };
}

const tokenFields = {
  tokenEnc: v.string(),
  refreshTokenEnc: v.string(),
  tokenExpiresAt: v.number(),
  scopes: v.optional(v.string()),
};

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** Creates the shop (or brings it back after an uninstall) with its new token; the key and settings survive reinstalls. */
export const ensureShop = internalMutation({
  args: { shop: v.string(), ...tokenFields },
  handler: async (ctx, { shop, ...token }) => {
    const now = Date.now();
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_shop", (q) => q.eq("shop", shop)).unique();
    if (s) {
      await ctx.db.patch("shopifyCodShops", s._id, { ...token, uninstalledAt: undefined, refreshLockUntil: undefined, updatedAt: now });
      return s.shopKey;
    }
    let shopKey = randomKey();
    while (await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique()) shopKey = randomKey();
    await ctx.db.insert("shopifyCodShops", { shop, shopKey, ...token, enabled: true, blockRefusers: false, installedAt: now, updatedAt: now });
    return shopKey;
  },
});

export const shopByDomain = internalQuery({
  args: { shop: v.string() },
  handler: (ctx, { shop }) => ctx.db.query("shopifyCodShops").withIndex("by_shop", (q) => q.eq("shop", shop)).unique(),
});

export const shopByKey = internalQuery({
  args: { shopKey: v.string() },
  handler: (ctx, { shopKey }) => ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique(),
});

/** The first page open (or a reinstall): id token → expiring offline token. Returns the shop's key. */
export async function install(ctx: ActionCtx, shop: string, idToken: string): Promise<string> {
  const { clientId, secret } = credentials();
  const data = await tokenRequest(shop, {
    client_id: clientId,
    client_secret: secret,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
  // A stale id token (they live about a minute): App Bridge retries with a fresh one.
  if (data.status === 400) throw new NeedsNewSession(`Shopify refused the session token (${data.error ?? 400})`);
  if (data.status !== 200) throw new Error(`Shopify token exchange failed (${data.status}${data.error ? `: ${data.error}` : ""})`);
  return ctx.runMutation(internal.shopifyCodAuth.ensureShop, { shop, ...(await encrypted(data)) });
}

export const installShop = internalAction({
  args: { shop: v.string(), idToken: v.string() },
  handler: (ctx, { shop, idToken }): Promise<string> => install(ctx, shop, idToken),
});

/** "fresh" = no refresh needed; a row = this caller holds the lock and must refresh; null = someone else is refreshing. */
export const claimRefresh = internalMutation({
  args: { shopKey: v.string() },
  handler: async (ctx, { shopKey }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (!s?.tokenEnc || s.uninstalledAt) throw new Error(`Shopify shop ${shopKey} isn't installed (open Istilam in Shopify admin)`);
    const now = Date.now();
    if (!s.tokenExpiresAt || s.tokenExpiresAt - now > REFRESH_BEFORE_MS) return "fresh" as const;
    if (s.refreshLockUntil && s.refreshLockUntil > now) return null;
    await ctx.db.patch("shopifyCodShops", s._id, { refreshLockUntil: now + LOCK_MS });
    return { shop: s.shop, refreshTokenEnc: s.refreshTokenEnc ?? "" };
  },
});

export const finishRefresh = internalMutation({
  args: { shopKey: v.string(), token: v.optional(v.object(tokenFields)) },
  handler: async (ctx, { shopKey, token }) => {
    const s = await ctx.db.query("shopifyCodShops").withIndex("by_key", (q) => q.eq("shopKey", shopKey)).unique();
    if (s) await ctx.db.patch("shopifyCodShops", s._id, { ...(token ?? {}), refreshLockUntil: undefined, updatedAt: Date.now() });
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A current access token for the shop, refreshing it (once, under the lock) shortly before it runs out. */
export async function shopToken(ctx: ActionCtx, shopKey: string): Promise<{ shop: string; token: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const claim = await ctx.runMutation(internal.shopifyCodAuth.claimRefresh, { shopKey });
    if (claim === "fresh") break;
    if (!claim) {
      await sleep(1000);
      continue;
    }
    try {
      const { clientId, secret } = credentials();
      const data = await tokenRequest(claim.shop, {
        client_id: clientId,
        client_secret: secret,
        grant_type: "refresh_token",
        refresh_token: await decryptToken(claim.refreshTokenEnc, tokenKey()),
      });
      if (data.status !== 200) throw new Error(`Shopify token refresh failed (${data.status}${data.error ? `: ${data.error}` : ""}); open Istilam in Shopify admin`);
      // Refresh tokens rotate: save the new pair before letting go of the lock.
      await ctx.runMutation(internal.shopifyCodAuth.finishRefresh, { shopKey, token: await encrypted(data) });
      break;
    } catch (e) {
      await ctx.runMutation(internal.shopifyCodAuth.finishRefresh, { shopKey });
      throw e;
    }
  }
  const s = await ctx.runQuery(internal.shopifyCodAuth.shopByKey, { shopKey });
  if (!s?.tokenEnc) throw new Error(`Shopify shop ${shopKey} isn't installed (open Istilam in Shopify admin)`);
  return { shop: s.shop, token: await decryptToken(s.tokenEnc, tokenKey()) };
}

export const currentToken = internalAction({
  args: { shopKey: v.string() },
  handler: (ctx, { shopKey }): Promise<{ shop: string; token: string }> => shopToken(ctx, shopKey),
});

/** Admin GraphQL for the shop; errors read "Shopify: …" (without AdSpy Pro's reconnect advice). */
export async function gql<T = Record<string, unknown>>(ctx: ActionCtx, shopKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const { shop, token } = await shopToken(ctx, shopKey);
  try {
    return await orderGql<T>(shop, token, query, variables, ISTILAM_API_VERSION);
  } catch (e) {
    if (!(e instanceof ShopifyError)) throw e;
    const msg = e.code === "RECONNECT" ? "access refused, open Istilam in Shopify admin" : e.message.replace(/^Shopify: /, "");
    const err = new Error(`Shopify: ${msg}`.slice(0, 300));
    (err as { cause?: unknown }).cause = e;
    throw err;
  }
}
