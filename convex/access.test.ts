/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const page = { paginationOpts: { numItems: 5, cursor: null } };

// Product, ad, store and trend data is for signed-in users. Backend code with no
// user (agents, assistant tools, MCP) reads it through the internal twins, and the
// homepage gets small public previews.
describe("data queries need a signed-in user", () => {
  it("refuses anonymous callers", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.ads.list, page)).rejects.toThrow(/sign in/i);
    await expect(t.query(api.products.list, page)).rejects.toThrow(/sign in/i);
    await expect(t.query(api.winners.feed, page)).rejects.toThrow(/sign in/i);
    await expect(t.query(api.stores.list, page)).rejects.toThrow(/sign in/i);
    await expect(t.query(api.trends.list, {})).rejects.toThrow(/sign in/i);
    await expect(t.query(api.trends.searchSuppliers, { ...page, search: "lamp" })).rejects.toThrow(/sign in/i);
    await expect(t.query(api.dashboard.justAdded, {})).rejects.toThrow(/sign in/i);
  });

  it("answers signed-in users", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "u1|session" });
    expect((await t.query(api.ads.list, page)).page).toEqual([]);
    expect((await t.query(api.products.list, page)).page).toEqual([]);
    expect((await t.query(api.winners.feed, page)).page).toEqual([]);
  });

  it("lets backend code read through the internal queries without a user", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(internal.ads.listInternal, page)).page).toEqual([]);
    expect((await t.query(internal.products.listInternal, page)).page).toEqual([]);
    expect(await t.query(internal.ads.getNichesInternal, {})).toBeDefined();
  });

  it("keeps the homepage previews and aggregate counts public", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.winners.homepagePreview, {})).toEqual([]);
    expect(await t.query(api.ads.homepagePreview, {})).toEqual([]);
    expect(await t.query(api.winners.summary, {})).toBeDefined();
    expect(await t.query(api.stats.get, {})).toBeDefined();
  });
});
