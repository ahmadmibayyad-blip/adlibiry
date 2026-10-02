/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { upsertAuthUser } from "./lib/authUser";

const modules = import.meta.glob("./**/*.ts");

describe("sign-in user linking", () => {
  it("first account is admin; Google with the same verified email signs into it", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const pw = await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "Me@Gmail.com", name: "Ahmad" } });
      expect(await ctx.db.get("users", pw)).toMatchObject({ email: "me@gmail.com", role: "admin", tokenIdentifier: pw });

      const google = await upsertAuthUser(ctx, {
        existingUserId: null, type: "oauth", profile: { email: "me@gmail.com", name: "Ahmad M", image: "https://pic", emailVerified: true },
      });
      expect(google).toBe(pw);
      const user = await ctx.db.get("users", pw);
      expect(user).toMatchObject({ name: "Ahmad", image: "https://pic", role: "admin" });
      expect(user?.emailVerificationTime).toBeTypeOf("number");
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
    });
  });

  it("never links without a Google-verified email, and new users are not admin", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const admin = await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "boss@x.com" } });
      const unverified = await upsertAuthUser(ctx, { existingUserId: null, type: "oauth", profile: { email: "boss@x.com", emailVerified: false } });
      expect(unverified).not.toBe(admin);
      const pwSameEmail = await upsertAuthUser(ctx, { existingUserId: null, type: "credentials", profile: { email: "new@x.com" } });
      expect(await ctx.db.get("users", pwSameEmail)).toMatchObject({ role: "user" });
      // A returning sign-in keeps its user.
      expect(await upsertAuthUser(ctx, { existingUserId: admin, type: "credentials", profile: { email: "boss@x.com" } })).toBe(admin);
    });
  });
});
