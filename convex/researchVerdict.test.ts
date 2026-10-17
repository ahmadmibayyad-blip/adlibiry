/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("AI research verdict", () => {
  it("researches a product from AdSpy's evidence and the supplier's reviews, and saves the report", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    let prompt = "";
    let system = "";
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("feedback.aliexpress.com")) {
        return json({ data: { productEvaluationStatistic: { evarageStar: 4.7, totalNum: 15, fiveStarNum: 13, threeStarNum: 2 }, evaViewList: [
          { buyerEval: 60, buyerTranslationFeedback: "Its very poor quality, broke in a week" },
        ] } });
      }
      const body = JSON.parse(String(init?.body));
      prompt = body.messages[0].content;
      system = body.system;
      const answer = {
        call: "research more", bottomLine: "Real ads in Denmark, but quality complaints. Vet the supplier next.",
        reasons: [{ text: "6 ads by 3 advertisers, longest 40 days", label: "adspy" }], risks: [{ text: "A 3★ quality complaint", blocker: false }],
        fixes: [], missing: ["Delivery time to Denmark"], checklist: ["Order a sample"], nextTask: "supplier vetting", nextTaskWhy: "Quality is the main doubt.",
      };
      return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } });
    }));
    const t = convexTest(schema, modules);
    const productId = await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin", targetCountry: "DK" });
      const id = await ctx.db.insert("products", {
        title: "Self-cleaning pet brush", description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z", price: 24.99, cost: 4.09, costSource: "aliexpress",
        supplierMatches: [{ title: "Pet brush", price: 1.09, url: "https://www.aliexpress.com/item/1005012573349832.html", orders: 238, similarity: 0.6 }],
        saturationByCountry: [{ country: "DK", advertisers: 3, level: "Low" }],
      });
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert("ads", {
          advertiserName: `Shop ${i % 3}`, platform: "Facebook", country: "DK", niche: "Pet Supplies", headline: `Hook ${i}`, bodyText: "Vets hate it! 50,000 sold",
          creativeUrl: "", landingPageUrl: "", spendEstimate: "Unknown", likes: i, views: "0", daysRunning: 10 + i * 6, aiScore: 50, firstSeenAt: "2026-09-01T00:00:00Z",
          targeting: { ageRange: "18-65", gender: "All", interests: [] }, source: "apify", productId: id,
        });
      }
      return id;
    });
    const me = t.withIdentity({ subject: "u1|s" });

    expect(await me.query(api.researchReports.latest, { productId })).toBeNull();
    const r = await me.action(api.ai.researchProduct, { productId });
    expect(r).toMatchObject({ call: "research", nextTask: "supplier vetting", reasons: [{ label: "adspy" }] });

    // The AI got AdSpy's evidence, the money maths, the supplier's reviews and the user's market; the ad claims marked as such.
    expect(system).toContain("skeptical");
    expect(system).toContain("A thin margin on an estimated (category benchmark) price is not a hard blocker");
    // VAT is applied: the margin line must not list it as left out, and the break-even is the after-VAT profit.
    expect(prompt).not.toContain("VAT/tax");
    expect(prompt).toContain("Not included: refunds, discounts, chargebacks, apps.");
    expect(prompt).toContain("The break-even ad cost per sale is the profit after DK VAT, given in the RULES block.");
    expect(prompt).toContain("The user sells to: DK");
    expect(prompt).toContain("6 ads by 3 advertisers, longest running 40 days");
    expect(prompt).toContain("Competition in DK: 3 advertisers this week (Low)");
    expect(prompt).toContain("= $19.88 per sale (80%)");
    expect(prompt).toContain('Complaints: "Its very poor quality, broke in a week"');
    expect(prompt.indexOf("NOT EVIDENCE")).toBeLessThan(prompt.indexOf("Vets hate it"));

    const saved = await me.query(api.researchReports.latest, { productId });
    expect(saved).toMatchObject({ report: { call: "research" }, margin: { breakEvenAdCost: 19.88 }, reviews: { total: 15, complaints: ["Its very poor quality, broke in a week"] } });

    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" }));
    expect(await t.withIdentity({ subject: "u2|s" }).query(api.researchReports.latest, { productId })).toBeNull(); // someone else's report stays theirs
  });

  // Stubs Claude (returns `call`) and the supplier reviews; `seen.prompt` is the last prompt Claude got.
  function stubClaude(call: string) {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const seen = { prompt: "" };
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("feedback.aliexpress.com")) return json({ data: {} });
      seen.prompt = JSON.parse(String(init?.body)).messages[0].content;
      const answer = { call, bottomLine: "x", reasons: [], risks: [], fixes: [], missing: [], checklist: [], nextTask: "supplier vetting", nextTaskWhy: "y" };
      return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 } });
    }));
    return seen;
  }

  async function seedAds(t: ReturnType<typeof convexTest>, product: Record<string, unknown>) {
    return t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "admin", targetCountry: "DK" });
      const id = await ctx.db.insert("products", {
        description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z", price: 24.99,
        title: "Pet brush", ...product,
      } as never);
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("ads", {
          advertiserName: `Shop ${i}`, platform: "Facebook", country: "DK", niche: "Pet Supplies", headline: `Hook ${i}`, bodyText: "Great",
          creativeUrl: "", landingPageUrl: "", spendEstimate: "Unknown", likes: i, views: "0", daysRunning: 30, aiScore: 50, firstSeenAt: "2026-09-01T00:00:00Z",
          targeting: { ageRange: "18-65", gender: "All", interests: [] }, source: "apify", productId: id,
        });
      }
      return id;
    });
  }

  it("caps the AI's test when the cost is unknown", async () => {
    stubClaude("test");
    const t = convexTest(schema, modules);
    const productId = await seedAds(t, {
      supplierMatches: [{ title: "Pet brush", price: 1.09, url: "https://www.aliexpress.com/item/1005012573349832.html", orders: 1000, similarity: 0.6 }],
    });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.ai.researchProduct, { productId });
    expect(r.call).toBe("research");
    const saved = await me.query(api.researchReports.latest, { productId });
    expect(saved).toMatchObject({ report: { call: "research" }, aiCall: "test", rulesVersion: 2, rules: { cappedBy: "supplier cost unknown" }, vat: { rate: 0.25, country: "DK" } });
  });

  it("skips a famous brand and tells the AI", async () => {
    const seen = stubClaude("test");
    const t = convexTest(schema, modules);
    const productId = await seedAds(t, { title: "Stanley Quencher 40oz", cost: 5, costSource: "aliexpress" });
    const me = t.withIdentity({ subject: "u1|s" });
    const r = await me.action(api.ai.researchProduct, { productId });
    expect(r.call).toBe("skip");
    expect(seen.prompt).toContain("HARD BLOCKER: Famous brand: Stanley");
    // No launched product, so own-store orders were not measured: unknown, not zero.
    expect(seen.prompt).toContain("ownStore (not measured)");
    expect(seen.prompt).not.toContain("0 own-store orders");
    expect(await me.query(api.researchReports.latest, { productId })).toMatchObject({ ownStore: { reason: "no_launch" } });
  });

  it("lists the user's latest verdict per product, for the badges in product lists", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      const other = await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
      const product = (title: string) => ctx.db.insert("products", {
        title, description: "", imageUrl: "", category: "Pet Supplies", tags: [], aiScore: 70, saturation: "Medium", trend: "Rising",
        supplierUrl: "", adExamples: [], isWinnerOfDay: false, publishedAt: "2026-10-01T00:00:00Z",
      });
      const a = await product("A");
      const b = await product("B");
      const report = (userId: typeof me, productId: typeof a, call: string, createdAt: string) =>
        ctx.db.insert("researchReports", { userId, productId, report: { call }, margin: null, createdAt });
      await report(me, a, "research", "2026-10-01T00:00:00Z");
      await report(me, a, "test", "2026-10-05T00:00:00Z");
      await report(other, b, "skip", "2026-10-05T00:00:00Z");
      return [a, b];
    });
    expect(await t.query(api.researchReports.myCalls, {})).toEqual([]);
    expect(await t.withIdentity({ subject: "u1|s" }).query(api.researchReports.myCalls, {})).toEqual([{ productId: a, call: "test" }]);
    expect(await t.withIdentity({ subject: "u2|s" }).query(api.researchReports.myCalls, {})).toEqual([{ productId: b, call: "skip" }]);
  });
});
