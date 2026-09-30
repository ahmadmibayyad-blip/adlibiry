/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("AI assistant daily limit", () => {
  it("counts messages per user and stops at the limit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    const user = t.withIdentity({ subject: "u1|session" });
    expect(await user.mutation(internal.assistantUsage.claimMessage, { limit: 2 })).toEqual({ allowed: true, used: 1, signedIn: true });
    expect(await user.mutation(internal.assistantUsage.claimMessage, { limit: 2 })).toEqual({ allowed: true, used: 2, signedIn: true });
    expect(await user.mutation(internal.assistantUsage.claimMessage, { limit: 2 })).toEqual({ allowed: false, used: 2, signedIn: true });
  });

  it("does not cap admins", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" });
    });
    const admin = t.withIdentity({ subject: "a1|session" });
    await admin.mutation(internal.assistantUsage.claimMessage, { limit: 1 });
    expect((await admin.mutation(internal.assistantUsage.claimMessage, { limit: 1 })).allowed).toBe(true);
  });

  it("refuses signed-out visitors", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.assistantUsage.claimMessage, { limit: 5 })).toEqual({ allowed: false, used: 0, signedIn: false });
  });
});
