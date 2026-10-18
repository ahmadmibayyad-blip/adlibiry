/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAX_PER_PAGE } from "./savedSearches";

const modules = import.meta.glob("./**/*.ts");
const PAGE = "adspy.savedSearches";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
  });
  return { t, me: t.withIdentity({ subject: "u1|s" }), other: t.withIdentity({ subject: "u2|s" }) };
}

describe("saved searches", () => {
  it("saves on the account, replaces by name and deletes", async () => {
    const { me, other } = await setup();
    await me.mutation(api.savedSearches.save, { page: PAGE, name: "DK pets", filters: { country: "DK", niches: ["Pet Supplies"] }, search: "" });
    await me.mutation(api.savedSearches.save, { page: PAGE, name: "Videos", filters: { media: "video" }, search: "mat" });
    await me.mutation(api.savedSearches.save, { page: PAGE, name: "DK pets", filters: { country: "DK" }, search: "" });
    expect(await me.query(api.savedSearches.list, { page: PAGE })).toEqual([
      { name: "DK pets", filters: { country: "DK" }, search: "" },
      { name: "Videos", filters: { media: "video" }, search: "mat" },
    ]);
    // Per page and per user.
    expect(await me.query(api.savedSearches.list, { page: "products.savedSearches" })).toEqual([]);
    expect(await other.query(api.savedSearches.list, { page: PAGE })).toEqual([]);

    await me.mutation(api.savedSearches.remove, { page: PAGE, name: "Videos" });
    expect((await me.query(api.savedSearches.list, { page: PAGE }))?.map((s) => s.name)).toEqual(["DK pets"]);
  });

  it("keeps the newest 20 and refuses unknown pages and signed-out users", async () => {
    const { t, me } = await setup();
    for (let i = 0; i < MAX_PER_PAGE + 2; i++) await me.mutation(api.savedSearches.save, { page: PAGE, name: `S${i}`, filters: {}, search: "" });
    const names = (await me.query(api.savedSearches.list, { page: PAGE }))!.map((s) => s.name);
    expect(names).toHaveLength(MAX_PER_PAGE);
    expect(names[0]).toBe(`S${MAX_PER_PAGE + 1}`);
    expect(names).not.toContain("S0");
    await expect(me.mutation(api.savedSearches.save, { page: "nope", name: "x", filters: {}, search: "" })).rejects.toThrow(/Unknown page/);
    await expect(t.mutation(api.savedSearches.save, { page: PAGE, name: "x", filters: {}, search: "" })).rejects.toThrow(/sign in/);
    expect(await t.query(api.savedSearches.list, { page: PAGE })).toBeNull();
  });

  it("copies a browser's older searches once, keeping their order and the account's own", async () => {
    const { me } = await setup();
    await me.mutation(api.savedSearches.save, { page: PAGE, name: "Already here", filters: { a: 1 }, search: "" });
    const local = [
      { name: "Newest local", filters: { b: 1 }, search: "" },
      { name: "Already here", filters: { a: 2 }, search: "" },
      { name: "Oldest local", filters: { c: 1 }, search: "x" },
    ];
    expect(await me.mutation(api.savedSearches.importLocal, { page: PAGE, items: local })).toEqual({ added: 2 });
    const list = await me.query(api.savedSearches.list, { page: PAGE });
    expect(list?.find((s) => s.name === "Already here")?.filters).toEqual({ a: 1 });
    const names = list!.map((s) => s.name);
    expect(names.indexOf("Newest local")).toBeLessThan(names.indexOf("Oldest local"));
  });
});
