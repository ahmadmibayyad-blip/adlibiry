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
    expect(calls[0].body).toMatchObject({ urls: [{ url: "https://www.store.com/products/pillow" }], viewportWidth: 1280, scrollToBottom: true });
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
