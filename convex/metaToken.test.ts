/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { readTokenDebug, tokenWarning } from "./lib/metaAdLibrary";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-18T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("readTokenDebug", () => {
  it("takes the earlier of the token's and its data access end", () => {
    const at = NOW / 1000;
    expect(readTokenDebug({ data: { is_valid: true, expires_at: at + 50 * 86400, data_access_expires_at: at + 40 * 86400 } }, 200)).toEqual({
      valid: true,
      expiresAt: NOW + 40 * DAY,
    });
    expect(readTokenDebug({ data: { is_valid: true, expires_at: 0, data_access_expires_at: 0 } }, 200)).toEqual({ valid: true, expiresAt: null });
  });

  it("reports an expired or rejected token", () => {
    expect(readTokenDebug({ data: { is_valid: false, expires_at: 1, error: { message: "Session has expired" } } }, 200)).toMatchObject({
      valid: false,
      error: "Session has expired",
    });
    expect(readTokenDebug({ error: { code: 190, message: "Invalid OAuth access token." } }, 400)).toMatchObject({ valid: false, error: expect.stringMatching(/code 190/) });
  });
});

describe("tokenWarning", () => {
  it("says how long is left, and warns in the last week", () => {
    expect(tokenWarning({ valid: true, expiresAt: NOW + 52 * DAY }, NOW)).toEqual({ level: "ok", text: "The Meta token expires in 52 days (2026-12-09)." });
    expect(tokenWarning({ valid: true, expiresAt: NOW + 3 * DAY + 1000 }, NOW)).toMatchObject({ level: "soon", text: expect.stringMatching(/^The Meta token expires in 3 days \(2026-10-21\)/) });
    expect(tokenWarning({ valid: true, expiresAt: NOW + 1000 }, NOW).text).toMatch(/expires today/);
    expect(tokenWarning({ valid: true, expiresAt: NOW - 1 }, NOW).level).toBe("dead");
    expect(tokenWarning({ valid: false, expiresAt: null }, NOW).level).toBe("dead");
    expect(tokenWarning({ valid: true, expiresAt: null }, NOW)).toEqual({ level: "ok", text: "The Meta token doesn't expire." });
  });
});

describe("metaToken.save", () => {
  it("alerts each admin once a day in the last week, and shows the state in Admin", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const [admin] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }),
      await ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }),
    ]);
    await t.mutation(internal.metaToken.save, { valid: true, expiresAt: NOW + 30 * DAY });
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);

    await t.mutation(internal.metaToken.save, { valid: true, expiresAt: NOW + 3 * DAY });
    await t.mutation(internal.metaToken.save, { valid: true, expiresAt: NOW + 3 * DAY }); // same day: no second alert
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: admin, type: "admin_alert", title: "Meta token expires soon", link: "/dashboard/admin" });

    vi.setSystemTime(NOW + DAY);
    await t.mutation(internal.metaToken.save, { valid: false, error: "Session has expired" });
    const after = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(after.map((n) => n.title)).toEqual(["Meta token expires soon", "Meta import stopped: token expired"]);

    const status = await t.withIdentity({ subject: "a1|s" }).query(api.metaToken.status, {});
    expect(status).toMatchObject({ level: "dead" });
    await expect(t.withIdentity({ subject: "u1|s" }).query(api.metaToken.status, {})).rejects.toThrow();
  });
});
