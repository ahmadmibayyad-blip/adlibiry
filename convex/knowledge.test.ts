/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("Knowledge read progress", () => {
  it("marks guides read and unread per user", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
      await ctx.db.insert("users", { tokenIdentifier: "u2", role: "user" });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.query(api.knowledge.myReads, {})).toEqual([]);
    expect(await me.mutation(api.knowledge.toggleRead, { guideId: "unit-economics" })).toBe(true);
    expect(await me.mutation(api.knowledge.toggleRead, { guideId: "aov" })).toBe(true);
    expect((await me.query(api.knowledge.myReads, {})).sort()).toEqual(["aov", "unit-economics"]);
    expect(await me.mutation(api.knowledge.toggleRead, { guideId: "aov" })).toBe(false);
    expect(await me.query(api.knowledge.myReads, {})).toEqual(["unit-economics"]);
    expect(await t.withIdentity({ subject: "u2|s" }).query(api.knowledge.myReads, {})).toEqual([]);
    expect(await t.query(api.knowledge.myReads, {})).toEqual([]);
    await expect(t.mutation(api.knowledge.toggleRead, { guideId: "aov" })).rejects.toThrow(/sign in/);
    await expect(me.mutation(api.knowledge.toggleRead, { guideId: "../../x" })).rejects.toThrow(/Unknown guide/);
  });
});
