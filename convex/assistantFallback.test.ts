/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { asksAboutStores, fallbackSystem, matchNiches, searchWords } from "./lib/assistantFallback";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const noCredit = () =>
  new Response(
    JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }),
    { status: 400, headers: { "content-type": "application/json" } },
  );

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
    await ctx.db.insert("products", {
      title: "Pet cooling mat", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 80, saturation: "Unknown",
      trend: "Rising", supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-09-01T00:00:00.000Z", price: 39.99, cost: 9,
    });
  });
  return t.withIdentity({ subject: "a1|s" });
}

const ask = { messages: [{ role: "user" as const, content: "Find 5 winning pet products with good margins" }] };

describe("Ask AI when Claude can't answer", () => {
  it("answers with Kimi from the products looked up for the question", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("KIMI_API_KEY", "kimi-key");
    let kimiBody: { messages: { role: string; content: string }[] } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("api.anthropic.com")) return noCredit();
      if (url.includes("api.moonshot.ai")) {
        kimiBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "k", model: "kimi-k2.6", choices: [{ message: { content: "Try the Pet cooling mat (77% margin)." }, finish_reason: "stop" }] }), { status: 200 });
      }
      return new Response("", { status: 404 });
    }));
    const me = await setup();
    const r = await me.action(api.assistant.chat, ask);
    expect(r.reply).toBe("Try the Pet cooling mat (77% margin).");
    const system = kimiBody!.messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("can't call tools");
    expect(system.content).toContain('"title":"Pet cooling mat"');
    expect(system.content).toContain('"marginPercent":77');
    expect(kimiBody!.messages.at(-1)).toEqual({ role: "user", content: ask.messages[0].content });
  });

  it("still says the AI is out of credit when there's no backup", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => noCredit()));
    const me = await setup();
    await expect(me.action(api.assistant.chat, ask)).rejects.toThrow(/out of credit/);
  });

  it("says the backup failed too when Kimi errors", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("KIMI_API_KEY", "kimi-key");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) =>
      String(u instanceof Request ? u.url : u).includes("moonshot") ? new Response(JSON.stringify({ error: { message: "insufficient balance" } }), { status: 402 }) : noCredit(),
    ));
    const me = await setup();
    await expect(me.action(api.assistant.chat, ask)).rejects.toThrow(/backup AI couldn't answer either.*insufficient balance/);
  });
});

describe("lookup helpers", () => {
  it("keeps the words worth searching for", () => {
    expect(searchWords("Find 5 winning pet products with good margins")).toBe("pet");
    expect(searchWords("Write 3 TikTok hooks for a posture corrector")).toBe("tiktok hooks posture corrector");
    expect(searchWords("What category should a beginner start with?")).toBe("category");
  });
  it("finds the niches a message names", () => {
    const niches = ["Beauty", "Home & Garden", "Pet Supplies", "Pets"];
    expect(matchNiches("Find 5 winning pet products", niches)).toEqual(["Pet Supplies", "Pets"]);
    expect(matchNiches("Which beauty ads run longest?", niches)).toEqual(["Beauty"]);
    expect(matchNiches("posture corrector hooks", niches)).toEqual([]);
  });
  it("asks for stores only when the question is about them", () => {
    expect(asksAboutStores("Which stores use Klaviyo?")).toBe(true);
    expect(asksAboutStores("Find pet products")).toBe(false);
  });
  it("puts the data in the prompt and says when nothing was found", () => {
    expect(fallbackSystem("Base", [{ label: "Products", json: '[{"id":1}]' }, { label: "Stores", json: "" }])).toMatch(/Base[\s\S]*Products:\n\[\{"id":1\}\]$/);
    expect(fallbackSystem("Base", [{ label: "Ads", json: "[]" }])).toContain("found nothing");
  });
});
