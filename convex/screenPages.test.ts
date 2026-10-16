/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { settle } from "./lib/settle";

const modules = import.meta.glob("./**/*.ts");
const shot = [{ data: Buffer.from("fake jpeg").toString("base64"), mediaType: "image/jpeg" }];
const page = (h1: string) => `<!DOCTYPE html><html><head><title>${h1}</title><script src="https://cdn.tailwindcss.com"></script></head><body><h1>${h1}</h1>${"<p>Soft cotton cover.</p>".repeat(10)}</body></html>`;

// Fake Claude: answers each request with the next text, and keeps what was asked.
function stubClaude(answers: string[]) {
  const asked: { system?: string; messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] }[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    asked.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "text", text: answers.shift() ?? "" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return asked;
}

async function setup(user: Record<string, unknown> = {}) {
  process.env.ANTHROPIC_API_KEY = "test";
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user", ...user });
    await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
  });
  return { t, me: t.withIdentity({ subject: "u1|s" }), other: t.withIdentity({ subject: "u2|s" }) };
}

afterEach(() => vi.unstubAllGlobals());

describe("screenshot to page", () => {
  it("makes a page from the screenshot, changes it on request and undoes the change", async () => {
    const { t, me, other } = await setup({ role: "admin" });
    const asked = stubClaude(["Here you go:\n```html\n" + page("Dream Pillow") + "\n```", page("Dream Pillow, green")]);
    const { id } = await me.action(api.screenPagesAi.create, { images: shot, notes: "Write it in Danish" });
    expect((await me.query(api.screenPages.get, { id }))?.status).toBe("making");
    await settle(t);
    const made = await me.query(api.screenPages.get, { id });
    expect(made).toMatchObject({ status: "ready", title: "Dream Pillow", canUndo: false });
    expect(made?.html).toBe(page("Dream Pillow"));
    expect(made?.imageUrls).toHaveLength(1);
    // The screenshot and the notes went to Claude.
    expect(asked[0].messages[0].content[0]).toMatchObject({ type: "image", source: { data: shot[0].data } });
    expect(asked[0].messages[0].content[1].text).toContain("Write it in Danish");
    expect(await other.query(api.screenPages.get, { id })).toBeNull(); // someone else's page

    await me.action(api.screenPagesAi.edit, { id, change: "Make the buttons green" });
    await settle(t);
    const changed = await me.query(api.screenPages.get, { id });
    expect(changed).toMatchObject({ status: "ready", title: "Dream Pillow", lastChange: "Make the buttons green", canUndo: true });
    expect(changed?.html).toContain("Dream Pillow, green");
    expect(asked[1].messages[0].content[1].text).toContain(page("Dream Pillow")); // the current page went with the change

    await me.mutation(api.screenPages.undo, { id });
    expect((await me.query(api.screenPages.get, { id }))?.html).toBe(page("Dream Pillow"));

    const list = await me.query(api.screenPages.mine, {});
    expect(list).toMatchObject({ used: 2, limit: 200, pages: [{ _id: id, title: "Dream Pillow", status: "ready" }] });
    await me.mutation(api.screenPages.remove, { id });
    expect(await me.query(api.screenPages.get, { id })).toBeNull();
  });

  it("builds the page with the user's products: names, prices, photos and links", async () => {
    const { t, me } = await setup({ role: "admin" });
    const [mine, theirs] = await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const product = (userId: (typeof users)[number]["_id"], title: string) =>
        ctx.db.insert("importedProducts", { userId, url: `https://mystore.com/products/${title.toLowerCase()}`, source: "shopify", title, description: "", category: "Other",
          imageUrl: `https://cdn.shopify.com/${title}.jpg`, images: [`https://cdn.shopify.com/${title}-2.jpg`], shownPrice: { amount: 349, currency: "DKK" }, createdAt: "2026-10-16" });
      return [await product(users[0]._id, "Pillow"), await product(users[1]._id, "Secret")];
    });
    const asked = stubClaude([page("Pillow page")]);
    const { id } = await me.action(api.screenPagesAi.create, { images: shot, productIds: [mine, theirs, mine] });
    await settle(t);
    const prompt = String(asked[0].messages[0].content[1].text);
    expect(prompt).toContain("The page sells this product instead of the screenshot's:");
    expect(prompt).toContain("1. Pillow | price 349.00 DKK | photos: https://cdn.shopify.com/Pillow.jpg https://cdn.shopify.com/Pillow-2.jpg | link: https://mystore.com/products/pillow");
    expect(prompt).not.toContain("Secret"); // someone else's product is left out
    expect((await me.query(api.screenPages.get, { id }))?.products).toEqual([{ title: "Pillow", imageUrl: "https://cdn.shopify.com/Pillow.jpg", url: "https://mystore.com/products/pillow" }]);
  });

  it("saves why a page failed and keeps the page when a change fails", async () => {
    const { t, me } = await setup({ role: "admin" });
    stubClaude(["Sorry, I can't build that.", page("Second try"), "no html"]);
    const first = await me.action(api.screenPagesAi.create, { images: shot });
    await settle(t);
    expect(await me.query(api.screenPages.get, { id: first.id })).toMatchObject({ status: "failed", error: expect.stringContaining("didn't return a page") });

    const second = await me.action(api.screenPagesAi.create, { images: shot });
    await settle(t);
    await me.action(api.screenPagesAi.edit, { id: second.id, change: "Bigger heading" });
    await settle(t);
    const kept = await me.query(api.screenPages.get, { id: second.id });
    expect(kept).toMatchObject({ status: "ready", error: expect.stringContaining("didn't return a page"), canUndo: false });
    expect(kept?.html).toBe(page("Second try"));
  });

  it("limits free accounts to two pages a day and checks the screenshot", async () => {
    const { t, me } = await setup();
    stubClaude([page("One"), page("Two")]);
    await expect(me.action(api.screenPagesAi.create, { images: [{ data: "aGk=", mediaType: "image/gif" }] })).rejects.toThrow(/JPG, PNG or WebP/);
    await me.action(api.screenPagesAi.create, { images: shot });
    await me.action(api.screenPagesAi.create, { images: shot });
    await settle(t);
    await expect(me.action(api.screenPagesAi.create, { images: shot })).rejects.toThrow(/Upgrade to Pro for 30 a day/);
    expect(await me.query(api.screenPages.mine, {})).toMatchObject({ used: 2, limit: 2 });
  });
});

describe("match a screenshot (Launch)", () => {
  it("reads the store's look from the screenshot", async () => {
    const { me } = await setup();
    stubClaude([JSON.stringify({ isPage: true, accent: "#E4572E", background: "#FFFDF8", surface: null, text: "#1d1d1d", roundness: "round", uppercase: false, heroLayout: "center", headingFont: "playfair display", bodyFont: "Comic Sans" })]);
    const r = await me.action(api.screenshotLook.read, { images: shot });
    expect(r.look).toMatchObject({ accent: "#e4572e", background: "#fffdf8", text: "#1d1d1d", roundness: "round", heroLayout: "center", headingFont: "Playfair Display" });
    expect(r.look?.bodyFont).toBeUndefined();
    expect(r.look?.changed.length).toBeGreaterThan(0);
  });

  it("says so when the picture isn't a web page", async () => {
    const { me } = await setup();
    stubClaude([JSON.stringify({ isPage: false, accent: null, background: null, surface: null, text: null, roundness: null, uppercase: null, heroLayout: null, headingFont: null, bodyFont: null })]);
    expect(await me.action(api.screenshotLook.read, { images: shot })).toEqual({ look: null, message: expect.stringContaining("doesn't look like a web page") });
  });
});

describe("screenshot from a link", () => {
  const png = Buffer.from("\x89PNG fake image bytes", "binary");
  function stubApify(calls: { url: string; body?: unknown; auth?: string | null }[], { fail = false } = {}) {
    vi.stubGlobal("fetch", async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (url.includes("/acts/apify~screenshot-url/run-sync-get-dataset-items")) {
        if (fail) return new Response(JSON.stringify({ error: { message: "Monthly usage hard limit exceeded" } }), { status: 402 });
        return Response.json([{ url: "https://store.com/", screenshotUrl: "https://api.apify.com/v2/key-value-stores/s1/records/shot?signature=x" }]);
      }
      if (url.startsWith("https://api.apify.com/v2/key-value-stores/s1/records/shot")) return new Response(png, { headers: { "content-type": "image/png" } });
      return new Response("", { status: 404 });
    });
  }

  it("takes a full-page screenshot of the page with Apify and sends it back", async () => {
    process.env.APIFY_TOKEN = "apify_test";
    const { me } = await setup();
    const calls: { url: string; body?: unknown; auth?: string | null }[] = [];
    stubApify(calls);
    const r = await me.action(api.pageShots.take, { url: "www.store.com/products/pillow" });
    expect(r).toEqual({ data: png.toString("base64"), mediaType: "image/png", host: "store.com" });
    expect(calls[0].url).toContain("token=apify_test");
    expect(calls[0].body).toMatchObject({ urls: [{ url: "https://www.store.com/products/pillow" }], viewportWidth: 1280, scrollToBottom: true, waitUntil: "domcontentloaded" });
    expect(calls[1].auth).toBe("Bearer apify_test");
    await expect(me.action(api.pageShots.take, { url: "http://localhost:3000" })).rejects.toThrow(/full address/);
  });

  it("limits free accounts and explains when Apify is out of credit", async () => {
    process.env.APIFY_TOKEN = "apify_test";
    const { me } = await setup();
    stubApify([], { fail: true });
    await expect(me.action(api.pageShots.take, { url: "https://store.com" })).rejects.toThrow(/used this month's credit/);
    for (let i = 0; i < 3; i++) await me.action(api.pageShots.take, { url: "https://store.com" }).catch(() => {});
    await expect(me.action(api.pageShots.take, { url: "https://store.com" })).rejects.toThrow(/taken 4 screenshots from links today/);
  });
});

describe("publish to Shopify", () => {
  type Call = { query: string; variables: Record<string, unknown> };
  const landingPage = `<!doctype html><html><head><title>Dream Pillow</title><script src="https://cdn.tailwindcss.com"></script></head><body>
<header><a href="#">Logo</a><nav><a href="#">Kudder</a><a href="#">Om os</a><a href="https://instagram.com/x">IG</a><a href="#" aria-label="Kurv"><svg></svg></a></nav></header>
<main><h1>Dream Pillow</h1>${"<p>Soft cotton cover.</p>".repeat(10)}<a href="#" class="btn">Køb nu</a></main></body></html>`;

  function stubShopify(calls: Call[], opts: { files?: Record<string, string>; refuse?: boolean; body?: string } = {}) {
    const files: Record<string, string> = { "templates/index.json": '{"sections":{"hero":{"type":"image-banner"}},"order":["hero"]}', ...(opts.files ?? {}) };
    vi.stubGlobal("fetch", async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("anthropic.com")) {
        // The AI's picks: the logo, the menu's pillows link, the cart, the product; "Om os" gets a path the store doesn't have.
        const links = [{ i: 0, url: "/" }, { i: 1, url: "/collections/puder" }, { i: 2, url: "/pages/made-up" }, { i: 4, url: "/cart" }, { i: 5, url: "/products/dream-pillow" }];
        return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ links }) }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      if (!url.includes("my-store.myshopify.com/admin/api/")) return new Response("", { status: 404 });
      const { query, variables } = JSON.parse(String(init?.body));
      calls.push({ query, variables });
      if (query.includes("MainTheme")) {
        const nodes = (variables.files as string[]).filter((f) => files[f] !== undefined).map((f) => ({ filename: f, body: { content: files[f] } }));
        return Response.json({ data: { shop: { myshopifyDomain: "my-store.myshopify.com", primaryDomain: { url: "https://mystore.com", host: "mystore.com" } }, themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/7", name: "Dawn", files: { nodes } }] } } });
      }
      if (query.includes("themeFilesUpsert")) {
        if (opts.refuse) return Response.json({ errors: [{ message: "Access denied for themeFilesUpsert field. Required access: write_themes access scope. Also: requires an exemption" }] });
        const written = variables.files as { filename: string; body: { value: string } }[];
        for (const f of written) files[f.filename] = f.body.value;
        return Response.json({ data: { themeFilesUpsert: { upsertedThemeFiles: written.map((f) => ({ filename: f.filename })), userErrors: [] } } });
      }
      if (query.includes("menus(")) {
        return Response.json({ data: {
          menus: { nodes: [{ handle: "main-menu", items: [{ title: "Puder", url: "https://mystore.com/collections/puder", items: [] }, { title: "Instagram", url: "https://instagram.com/x" }] }] },
          collections: { nodes: [{ title: "Puder", handle: "puder" }] }, pages: { nodes: [{ title: "Om os", handle: "om-os" }] }, products: { nodes: [{ title: "Dream Pillow", handle: "dream-pillow" }] },
        } });
      }
      if (query.includes("pageCreate")) return Response.json({ data: { pageCreate: { page: { id: "gid://shopify/Page/55", handle: "dream-pillow" }, userErrors: [] } } });
      if (query.includes("pageUpdate")) return Response.json({ data: { pageUpdate: { page: { id: "gid://shopify/Page/55", handle: "dream-pillow" }, userErrors: [] } } });
      if (query.includes("PageBody")) return Response.json({ data: { page: { body: opts.body ?? landingPage } } });
      return Response.json({ errors: [{ message: "unexpected" }] });
    });
    return files;
  }

  async function readyPage(store = true) {
    const s = await setup();
    const id = await s.t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", "u1")).unique();
      if (store) await ctx.db.insert("shopifyConnections", { userId: user!._id, shopDomain: "my-store.myshopify.com", shopName: "My Store", accessToken: "shpat_plain", connectedAt: "2026-10-01T00:00:00Z" });
      return ctx.db.insert("screenPages", { userId: user!._id, title: "Dream Pillow", imageIds: [], html: landingPage, status: "ready", createdAt: 1, updatedAt: 1 });
    });
    return { ...s, id };
  }

  it("adds the landing files, links the menu bar and buttons to the store, and updates the same page next time", async () => {
    const { me, id } = await readyPage();
    const calls: Call[] = [];
    const files = stubShopify(calls);
    const r = await me.action(api.screenPagesShopify.publish, { id });
    expect(r).toEqual({ url: "https://mystore.com/pages/dream-pillow", adminUrl: "https://my-store.myshopify.com/admin/pages/55", updated: false, home: false, linked: 4 });
    expect(files["templates/page.adspy-landing.liquid"]).toContain("{%- layout 'adspy-landing' -%}");
    expect(files["layout/adspy-landing.liquid"]).toContain("{{ content_for_header }}"); // Shopify's analytics and pixels
    const body = String((calls.find((c) => c.query.includes("pageCreate"))!.variables.page as { body: string }).body);
    expect(body.startsWith("<!DOCTYPE html>\n<html>")).toBe(true);
    expect(body).toContain('<a href="/">Logo</a>');
    expect(body).toContain('<a href="/collections/puder">Kudder</a>');
    expect(body).toContain('<a href="#">Om os</a>'); // a path the store doesn't have stays as it was
    expect(body).toContain('<a href="https://instagram.com/x">IG</a>');
    expect(body).toContain('<a href="/cart" aria-label="Kurv">');
    expect(body).toContain('<a href="/products/dream-pillow" class="btn">Køb nu</a>');
    const saved = await me.query(api.screenPages.get, { id });
    expect(saved).toMatchObject({ lastChange: "Linked the menu and buttons to your store", canUndo: true, shopify: { url: "https://mystore.com/pages/dream-pillow", home: false } });
    expect(saved!.updatedAt).toBeLessThanOrEqual(saved!.shopify!.publishedAt); // not "changed since"

    calls.length = 0;
    expect(await me.action(api.screenPagesShopify.publish, { id })).toMatchObject({ updated: true });
    expect(calls.some((c) => c.query.includes("themeFilesUpsert") || c.query.includes("pageCreate"))).toBe(false); // files already there
  });

  it("makes it the home page, keeps the theme's own, and restores it", async () => {
    const { me, id } = await readyPage();
    const files = stubShopify([]);
    const own = files["templates/index.json"];
    const r = await me.action(api.screenPagesShopify.publish, { id, asHome: true });
    expect(r).toMatchObject({ url: "https://mystore.com/", home: true });
    expect(JSON.parse(files["templates/index.json"])).toEqual({ layout: "adspy-landing", sections: { main: { type: "adspy-landing-home", settings: { page: "dream-pillow" } } }, order: ["main"] });
    // Again as home: the backup stays the theme's own, not the landing page's.
    await me.action(api.screenPagesShopify.publish, { id, asHome: true });
    await me.action(api.screenPagesShopify.restoreHome, { id });
    expect(files["templates/index.json"]).toBe(own);
    expect((await me.query(api.screenPages.get, { id }))?.shopify?.home).toBe(false);
  });

  it("shows the files to add when Shopify won't let the app, and needs a store", async () => {
    const { me, id } = await readyPage();
    const calls: Call[] = [];
    stubShopify(calls, { refuse: true });
    await expect(me.action(api.screenPagesShopify.publish, { id })).rejects.toThrow(/add them once yourself/);
    expect(calls.some((c) => c.query.includes("pageCreate"))).toBe(false); // no page that would show without its layout

    const noStore = await readyPage(false);
    await expect(noStore.me.action(api.screenPagesShopify.publish, { id: noStore.id })).rejects.toThrow(/Connect your Shopify store/);
  });

  it("warns when Shopify strips the page's styling code", async () => {
    const { me, id } = await readyPage();
    stubShopify([], { body: "<h1>Dream Pillow</h1>" });
    expect((await me.action(api.screenPagesShopify.publish, { id })).note).toMatch(/removed the page's styling/);
  });
});
