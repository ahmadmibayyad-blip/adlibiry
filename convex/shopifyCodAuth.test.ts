/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { decryptToken } from "./lib/shopifyOAuth";

const modules = import.meta.glob("./**/*.ts");
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SHOP = "istilam-dev.myshopify.com";

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tokenAnswer = (n: number) => json({ access_token: `shpat_${n}`, refresh_token: `shprt_${n}`, expires_in: 3600, refresh_token_expires_in: 7776000, scope: "read_orders" });

beforeEach(() => {
  vi.stubEnv("SHOPIFY_TOKEN_KEY", KEY);
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_ID", "istilam-client");
  vi.stubEnv("SHOPIFY_ISTILAM_CLIENT_SECRET", "istilam-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Istilam Shopify install", () => {
  it("exchanges the id token for an expiring offline token and stores it encrypted", async () => {
    const t = convexTest(schema, modules);
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://${SHOP}/admin/oauth/access_token`);
      bodies.push(new URLSearchParams(String(init.body)));
      return tokenAnswer(bodies.length);
    }));
    const key = await t.action(internal.shopifyCodAuth.installShop, { shop: SHOP, idToken: "id-token" });
    expect(key).toMatch(/^[a-z0-9]{10}$/);
    expect(Object.fromEntries(bodies[0])).toEqual({
      client_id: "istilam-client", client_secret: "istilam-secret",
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "id-token", subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1",
    });
    const [row] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(row.tokenEnc).toMatch(/^enc:v1:/);
    expect(await decryptToken(row.tokenEnc!, KEY)).toBe("shpat_1");
    expect(await decryptToken(row.refreshTokenEnc!, KEY)).toBe("shprt_1");
    expect(row.enabled).toBe(true);

    // Reinstall keeps the key and the merchant's settings.
    await t.run((ctx) => ctx.db.patch("shopifyCodShops", row._id, { enabled: false, uninstalledAt: 1 }));
    expect(await t.action(internal.shopifyCodAuth.installShop, { shop: SHOP, idToken: "id-2" })).toBe(key);
    const [again] = await t.run((ctx) => ctx.db.query("shopifyCodShops").collect());
    expect(again.enabled).toBe(false);
    expect(again.uninstalledAt).toBeUndefined();
  });

  it("refreshes a token about to expire once, even when asked twice at the same time", async () => {
    const t = convexTest(schema, modules);
    let n = 0;
    const grants: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      grants.push(new URLSearchParams(String(init.body)).get("grant_type") ?? "");
      return tokenAnswer(++n);
    }));
    const key = await t.action(internal.shopifyCodAuth.installShop, { shop: SHOP, idToken: "id-token" });
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("shopifyCodShops").first())!;
      await ctx.db.patch("shopifyCodShops", s._id, { tokenExpiresAt: Date.now() + 60_000 });
    });
    const [a, b] = await Promise.all([
      t.action(internal.shopifyCodAuth.currentToken, { shopKey: key }),
      t.action(internal.shopifyCodAuth.currentToken, { shopKey: key }),
    ]);
    expect(grants.filter((g) => g === "refresh_token")).toHaveLength(1);
    expect(a).toEqual({ shop: SHOP, token: "shpat_2" });
    expect(b).toEqual({ shop: SHOP, token: "shpat_2" });
  });

  it("says the shop must open the app when it has no token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(internal.shopifyCodAuth.currentToken, { shopKey: "nosuchshop" })).rejects.toThrow(/isn't installed/);
  });
});
