/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const product = { title: "Lawn sweeper", description: "Leaf collector", price: 129, cost: 60, category: "Home & Living" };

// The AI actions call a paid model. They must refuse before any network call
// when the caller is signed out or out of daily AI requests.
describe("AI actions require a signed-in user with requests left", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses signed-out callers without calling the model", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    await expect(t.action(api.ai.scoreProduct, product)).rejects.toThrow(/sign in/i);
    await expect(t.action(api.ai.generateAdAngles, { title: "x", description: "y", category: "Sports" })).rejects.toThrow(/sign in/i);
    await expect(t.action(api.ai.findCompetitors, { productTitle: "x", category: "Sports" })).rejects.toThrow(/sign in/i);
    await expect(
      t.action(api.saturation.analyze.analyzeSaturation, { productTitle: "x", niche: "Sports", country: "US" }),
    ).rejects.toThrow(/sign in/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a user who has used up today's AI requests", async () => {
    vi.stubEnv("ASSISTANT_DAILY_LIMIT", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("assistantUsage", { userId, day: new Date().toISOString().slice(0, 10), count: 1 });
    });
    const user = t.withIdentity({ subject: "u1|session" });
    await expect(user.action(api.ai.scoreProduct, product)).rejects.toThrow(/get 1 AI requests a day/);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
