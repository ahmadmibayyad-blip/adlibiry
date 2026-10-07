/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("stopping the pipeline", () => {
  it("lets an admin stop a run; its next step quits instead of continuing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { tokenIdentifier: "admin1", role: "admin" });
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" });
    });
    const admin = t.withIdentity({ subject: "admin1|s" });
    expect(await admin.mutation(api.productPipeline.stop, {})).toEqual({ stopped: false });
    await admin.mutation(api.productPipeline.runFrom, { stage: "lists" });
    await expect(t.withIdentity({ subject: "u1|s" }).mutation(api.productPipeline.stop, {})).rejects.toThrow();
    expect(await admin.mutation(api.productPipeline.stop, {})).toEqual({ stopped: true });

    const day = new Date().toISOString().slice(0, 10);
    await t.mutation(internal.productPipeline.step, { stage: "lists", cursor: null, day });
    const status = await admin.query(api.productPipeline.status, {});
    expect(status).toMatchObject({ state: "error", stage: "lists", error: 'Stopped by an admin at "lists"' });
    // A new run can start straight away.
    expect(await admin.mutation(api.productPipeline.runFrom, { stage: "emails" })).toEqual({ started: true });
  });
});
