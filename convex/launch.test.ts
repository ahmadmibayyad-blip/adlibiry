/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "app_secret";
const TOKEN_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("SHOPIFY_API_KEY", "client123");
  vi.stubEnv("SHOPIFY_API_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_TOKEN_KEY", TOKEN_KEY);
  vi.stubEnv("CONVEX_SITE_URL", "https://x.convex.site");
  vi.stubEnv("SITE_URL", "https://app.example");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function sign(message: string, encoding: "hex" | "base64") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return encoding === "hex" ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : btoa(String.fromCharCode(...bytes));
}

const product = {
  title: "posture corrector adjustable back brace", description: "", imageUrl: "https://cdn.x/p.jpg", images: ["https://cdn.x/p2.jpg"], price: 30, cost: 8,
  category: "Health & Wellness", tags: [], aiScore: 88, saturation: "Low", trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false,
  publishedAt: "2026-10-01T00:00:00.000Z", supplierMatches: [{ title: "brace", price: 5, url: "https://ali/1", orders: 1437, similarity: 0.8 }],
};

describe("Shopify app install", () => {
  it("connects a store through OAuth, stores the token encrypted, and forgets it on uninstall", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const user = t.withIdentity({ subject: "u1|s" });
    const { url } = await user.mutation(api.shopifyApp.startInstall, { shop: "My-Store" });
    const state = new URL(url).searchParams.get("state")!;
    expect(url).toContain("https://my-store.myshopify.com/admin/oauth/authorize?client_id=client123");

    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (String(u).endsWith("/admin/oauth/access_token")) return json({ access_token: "shpat_live_token", scope: "write_products" });
      if (String(u).includes("/graphql.json")) return json({ data: { shop: { name: "My Store", currencyCode: "DKK" }, shopLocales: [{ locale: "da", primary: true }] } });
      return new Response("", { status: 404 });
    }));
    const params = new URLSearchParams({ code: "c0de", shop: "my-store.myshopify.com", state, timestamp: "1700000000" });
    params.set("hmac", await sign([...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&"), "hex"));
    const res = await t.fetch(`/shopify/callback?${params}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://app.example/dashboard/launch/shopify-callback?shopify=connected");
    const [conn] = await t.run((ctx) => ctx.db.query("shopifyConnections").collect());
    expect(conn).toMatchObject({ shopDomain: "my-store.myshopify.com", shopName: "My Store", via: "oauth", currency: "DKK", locale: "da" });
    expect(conn.accessToken.startsWith("enc:v1:")).toBe(true);
    expect(await user.query(api.shopifyApp.status, {})).toMatchObject({ appReady: true, store: { shopName: "My Store", viaApp: true } });

    // The same link can't be replayed, and a forged callback is refused.
    const again = await t.fetch(`/shopify/callback?${params}`, { redirect: "manual" });
    expect(again.headers.get("Location")).toContain("shopify=error");
    params.set("hmac", "deadbeef");
    expect((await t.fetch(`/shopify/callback?${params}`, { redirect: "manual" })).headers.get("Location")).toContain("couldn%27t+be+verified");

    // Uninstall webhook (signed) removes the store.
    const body = JSON.stringify({ id: 1 });
    const bad = await t.fetch("/shopify/webhooks", { method: "POST", body, headers: { "X-Shopify-Topic": "app/uninstalled", "X-Shopify-Shop-Domain": "my-store.myshopify.com", "X-Shopify-Hmac-Sha256": "nope" } });
    expect(bad.status).toBe(401);
    const ok = await t.fetch("/shopify/webhooks", { method: "POST", body, headers: { "X-Shopify-Topic": "app/uninstalled", "X-Shopify-Shop-Domain": "my-store.myshopify.com", "X-Shopify-Hmac-Sha256": await sign(body, "base64") } });
    expect(ok.status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("shopifyConnections").collect())).toHaveLength(0);
  });
});

describe("Launch", () => {
  const aiCopy = {
    title: "Adjustable Posture Corrector", subtitle: "Sit straighter at your desk", benefits: ["Pulls shoulders back", "Fits under clothes", "Clinically proven results"],
    hook: "Tired back after desk days?", howItWorks: ["Put it on", "Tighten"], whatsIncluded: ["1 brace"], faq: [{ q: "Size?", a: "One size." }],
    shippingReturns: "Ships from our partner warehouse.", seo: { title: "Posture Corrector", description: "Adjustable brace." },
    adKit: [{ angle: "Desk workers", hook: "Your back at 5pm…", primaryText: "Wear it under your shirt.", headline: "Sit straighter" }],
  };

  async function setup(userFields: Record<string, unknown>) {
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...userFields });
      await ctx.db.insert("shopifyConnections", { userId, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z" });
      const p = await ctx.db.insert("products", product);
      const adId = await ctx.db.insert("ads", {
        advertiserName: "Corecare", platform: "Facebook", country: "US", niche: "Health & Wellness", headline: "Fix your posture", bodyText: "Wear it daily", creativeUrl: "",
        landingPageUrl: "", spendEstimate: "Unknown", likes: 0, views: "0", daysRunning: 30, aiScore: 80, firstSeenAt: "2026-09-01T00:00:00Z",
        targeting: { ageRange: "18-65", gender: "All", interests: [] }, source: "apify", productId: p, spokenHook: "Your back hurts because…",
      });
      await ctx.db.patch("products", p, { adIds: [adId] });
      return p;
    });
    return { t, productId, user: t.withIdentity({ subject: "u1|s" }) };
  }

  it("writes the page from the product and its winning ads, cleans the claims, and publishes a draft", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const prompts: string[] = [];
    let productSetInput: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        prompts.push(String(init?.body ?? ""));
        return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(aiCopy) }], usage: { input_tokens: 10, output_tokens: 10 } });
      }
      if (url.includes("/graphql.json")) {
        productSetInput = JSON.parse(String(init?.body)).variables.input;
        return json({ data: { productSet: { product: { id: "gid://shopify/Product/987", handle: "adjustable-posture-corrector", onlineStorePreviewUrl: "https://my-store.myshopify.com/products/x?preview=1" }, userErrors: [] } } });
      }
      return new Response("", { status: 404 });
    }));
    const { t, productId, user } = await setup({ plan: "pro", subscriptionStatus: "active" });
    const prep = await user.query(api.launch.prepare, { productId });
    expect(prep).toMatchObject({ allowed: { left: 10, limit: 10 }, store: { shopName: "My Store" }, suggested: { price: 21.99, cost: 8, marginPercent: 64 }, blocked: null });

    const { launchId } = await user.mutation(api.launch.start, { productId, language: "English", tone: "friendly", publish: "DRAFT" });
    await t.finishAllScheduledFunctions(() => {});
    const launch = await user.query(api.launch.get, { launchId });
    expect(launch).toMatchObject({ status: "published", adminUrl: "https://my-store.myshopify.com/admin/products/987", storeUrl: "https://my-store.myshopify.com/products/x?preview=1", price: 21.99 });
    expect(launch?.copy.benefits).toEqual(["Pulls shoulders back", "Fits under clothes"]); // "Clinically proven" dropped
    expect(prompts[0]).toContain("Your back hurts because…"); // the winning ad's spoken hook went into the prompt
    expect(productSetInput).toMatchObject({ title: "Adjustable Posture Corrector", status: "DRAFT", variants: [{ price: "21.99" }] });
    expect(String(productSetInput?.descriptionHtml)).toContain("1400+ ordered from our supplier");
    expect((await user.query(api.launch.prepare, { productId }))?.allowed).toMatchObject({ left: 9 });
  });

  it("makes AI product photos from the real one and adds them to the Shopify product", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    let productSetInput: { files: { originalSource: string }[] } | undefined;
    const geminiBodies: { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[] }[] = [];
    let geminiCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(aiCopy) }], usage: { input_tokens: 10, output_tokens: 10 } });
      }
      if (url === "https://cdn.x/p.jpg") return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } });
      if (url.includes("generativelanguage.googleapis.com")) {
        geminiBodies.push(JSON.parse(String(init?.body)));
        // The third photo fails; the launch still goes on with the other two.
        if (++geminiCalls === 3) return json({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] });
        return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: btoa(`png-${geminiCalls}`) } }] } }] });
      }
      if (url.includes("/graphql.json")) {
        productSetInput = JSON.parse(String(init?.body)).variables.input;
        return json({ data: { productSet: { product: { id: "gid://shopify/Product/987", handle: "x", onlineStorePreviewUrl: "https://my-store.myshopify.com/products/x" }, userErrors: [] } } });
      }
      return new Response("", { status: 404 });
    }));
    const { t, productId, user } = await setup({ plan: "pro", subscriptionStatus: "active" });

    // Without a Google key it's off, and a request for photos is ignored.
    expect(await user.query(api.launch.prepare, { productId })).toMatchObject({ aiPhotosReady: false });
    const off = await user.mutation(api.launch.start, { productId, language: "English", tone: "friendly", publish: "DRAFT", aiPhotos: 4 });
    await t.finishAllScheduledFunctions(() => {});
    expect(await user.query(api.launch.get, { launchId: off.launchId })).not.toHaveProperty("aiPhotos");
    expect(geminiBodies).toHaveLength(0);

    vi.stubEnv("GEMINI_API_KEY", "g-test");
    expect(await user.query(api.launch.prepare, { productId })).toMatchObject({ aiPhotosReady: true });
    const { launchId } = await user.mutation(api.launch.start, { productId, language: "English", tone: "friendly", publish: "DRAFT", aiPhotos: 4 });
    await t.finishAllScheduledFunctions(() => {});
    const launch = await user.query(api.launch.get, { launchId });
    expect(launch).toMatchObject({ status: "published", aiPhotos: 4, aiPhotoNote: "1 of 4 AI photos couldn't be made." });
    expect(launch?.aiPhotoUrls).toHaveLength(3);
    expect(geminiBodies).toHaveLength(4);
    expect(geminiBodies[0].contents[0].parts[1].inlineData).toEqual({ mimeType: "image/jpeg", data: btoa(String.fromCharCode(0xff, 0xd8, 0xff, 1, 2, 3)) });
    // The real photo first, then the AI photos, then the other real photos.
    expect(productSetInput?.files.map((f) => f.originalSource)).toEqual(["https://cdn.x/p.jpg", ...launch!.aiPhotoUrls!, "https://cdn.x/p2.jpg"]);
    const stored = await t.run(async (ctx) => Promise.all(launch!.aiPhotoIds!.map((id) => ctx.storage.get(id).then((b) => b?.text()))));
    expect(stored?.sort()).toEqual(["png-1", "png-2", "png-4"]);
  });

  it("keeps Launch to paying plans, blocks big brands, and caps the trial at 2", async () => {
    const free = await setup({});
    await expect(free.user.mutation(api.launch.start, { productId: free.productId, language: "English", tone: "bold", publish: "DRAFT" })).rejects.toThrow(/part of Pro/);

    const trial = await setup({ proTrialEndsAt: Date.now() + 86_400_000 });
    expect((await trial.user.query(api.launch.prepare, { productId: trial.productId }))?.allowed).toEqual({ left: 2, limit: 2 });
    await trial.t.run(async (ctx) => {
      const u = (await ctx.db.query("users").collect())[0];
      await ctx.db.insert("launchUsage", { userId: u._id, month: "2026-09", count: 2 });
    });
    await expect(trial.user.mutation(api.launch.start, { productId: trial.productId, language: "English", tone: "bold", publish: "DRAFT" })).rejects.toThrow(/used your 2 launches on the trial/);

    const pro = await setup({ plan: "pro", subscriptionStatus: "active" });
    await pro.t.run((ctx) => ctx.db.patch("products", pro.productId, { isBigBrand: true }));
    await expect(pro.user.mutation(api.launch.start, { productId: pro.productId, language: "English", tone: "bold", publish: "DRAFT" })).rejects.toThrow(/big-brand/);
  });

  it("records a clear failure when the AI isn't set up", async () => {
    const { t, productId, user } = await setup({ plan: "pro", subscriptionStatus: "active" });
    const { launchId } = await user.mutation(api.launch.start, { productId, language: "English", tone: "premium", publish: "ACTIVE" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await user.query(api.launch.get, { launchId })).toMatchObject({ status: "failed", error: "The AI isn't set up yet (missing ANTHROPIC_API_KEY)." });
    expect((await user.query(api.launch.prepare, { productId }))?.allowed).toMatchObject({ left: 10 }); // failures don't use the quota
  });
});
