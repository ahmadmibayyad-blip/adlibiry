/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import builtIn from "../src/data/knowledge.json";
import type { KContent } from "./lib/knowledge";

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

describe("Knowledge admin edits", () => {
  const BUILT_IN: KContent = { reviewed: builtIn.reviewed, topics: builtIn.topics as KContent["topics"], glossary: builtIn.glossary };

  it("lets admins save and reset the guides, and blocks everyone else", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin", role: "admin" });
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    const admin = t.withIdentity({ subject: "admin|s" });
    const user = t.withIdentity({ subject: "u1|s" });
    expect(await user.query(api.knowledge.content, {})).toBeNull();

    const edited = structuredClone(BUILT_IN);
    edited.topics[0].guides[0].title = "How it works, edited";
    await expect(user.mutation(api.knowledge.saveContent, { ...edited, baseUpdatedAt: null })).rejects.toThrow(/Admin access/);
    await expect(t.mutation(api.knowledge.saveContent, { ...edited, baseUpdatedAt: null })).rejects.toThrow(/Not logged in/);

    const v1 = await admin.mutation(api.knowledge.saveContent, { ...edited, baseUpdatedAt: null });
    const seen = await user.query(api.knowledge.content, {});
    expect(seen?.topics[0].guides[0].title).toBe("How it works, edited");
    expect(seen?.updatedAt).toBe(v1);

    // A second editor that opened the old version can't overwrite the newer save.
    await expect(admin.mutation(api.knowledge.saveContent, { ...BUILT_IN, baseUpdatedAt: null })).rejects.toThrow(/Someone saved/);
    await admin.mutation(api.knowledge.saveContent, { ...edited, baseUpdatedAt: v1 });

    const broken = structuredClone(edited);
    broken.topics[0].guides[0].title = "";
    await expect(admin.mutation(api.knowledge.saveContent, { ...broken, baseUpdatedAt: null })).rejects.toThrow(/title is empty/);

    await expect(user.mutation(api.knowledge.resetContent, {})).rejects.toThrow(/Admin access/);
    await admin.mutation(api.knowledge.resetContent, {});
    expect(await user.query(api.knowledge.content, {})).toBeNull();
  });
});
