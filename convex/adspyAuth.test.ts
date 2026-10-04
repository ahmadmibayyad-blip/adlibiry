/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import { authorizeWithBackend } from "./adspyAuth";
import { appPlan, userIdFromToken } from "./lib/adspyBackend";

const modules = import.meta.glob("./**/*.ts");

// base64url JWT like jsonwebtoken's sign({ id }, secret)
const jwt = (id: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ id, iat: 1 })).replace(/=+$/, "")}.sig`;

type Deps = Parameters<typeof authorizeWithBackend>[1];
const depsFor = (t: ReturnType<typeof convexTest>, extra: Partial<Deps> = {}): Deps => ({
  env: {},
  runQuery: (fn: FunctionReference<"query", "internal">, args: Record<string, unknown>) => t.query(fn, args as never),
  runMutation: (fn: FunctionReference<"mutation", "internal">, args: Record<string, unknown>) => t.mutation(fn, args as never),
  legacyUser: async () => null,
  ...extra,
});

// In-memory stand-in for the Render backend.
function fakeBackend() {
  const users = new Map<string, { id: string; password: string; plan: string; subscribed: boolean }>();
  let n = 0;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (path === "/user/register") {
      if (users.has(body.email)) return reply(409, { message: "User with this email already exists" });
      users.set(body.email, { id: `66f${String(++n).padStart(21, "0")}`, password: body.password, plan: "Free", subscribed: false });
      return reply(201, { message: "User registered successfully" });
    }
    if (path === "/user/login") {
      const u = users.get(body.email);
      if (!u || u.password !== body.password) return reply(404, { message: "User not found" });
      return reply(200, { message: "User login success", token: jwt(u.id) });
    }
    if (path === "/user/checkSubscription") {
      const token = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Bearer /, "");
      const u = [...users.values()].find((x) => x.id === userIdFromToken(token));
      if (!u) return reply(401, { message: "unauthorized" });
      return reply(u.subscribed ? 200 : 404, { user_name: "x", is_subscribed: u.subscribed, subscribed_plan: u.plan });
    }
    return reply(404, {});
  });
  return { users, calls, fetchMock };
}

describe("AdSpy Pro backend sign-in", () => {
  let backend: ReturnType<typeof fakeBackend>;
  beforeEach(() => {
    backend = fakeBackend();
    vi.stubGlobal("fetch", backend.fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = async () => {
    const t = convexTest(schema, modules);
    const signIn = (params: Record<string, unknown>) => authorizeWithBackend(params, depsFor(t));
    return { t, signIn };
  };

  it("signs up on the backend, then signs back in to the same user with its plan", async () => {
    const { t, signIn } = await setup();
    const admin = await t.run((ctx) => ctx.db.insert("users", { email: "boss@x.com", role: "admin", tokenIdentifier: "boss" }));
    const { userId } = await signIn({ flow: "signUp", email: "New@Shop.com ", password: "secret123", name: "Sara" });
    expect(userId).not.toBe(admin);
    expect(backend.users.get("new@shop.com")).toMatchObject({ password: "secret123" });
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toMatchObject({ email: "new@shop.com", name: "Sara", role: "user", plan: "none" });

    backend.users.get("new@shop.com")!.subscribed = true;
    backend.users.get("new@shop.com")!.plan = "Pro";
    expect((await signIn({ flow: "signIn", email: "new@shop.com", password: "secret123" })).userId).toBe(userId);
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toMatchObject({ plan: "pro", subscriptionStatus: "active" });
  });

  it("rejects wrong passwords and duplicate sign-ups with clear messages", async () => {
    const { signIn } = await setup();
    await signIn({ flow: "signUp", email: "a@b.co", password: "secret123" });
    await expect(signIn({ flow: "signIn", email: "a@b.co", password: "nope" })).rejects.toMatchObject({ data: { message: "Wrong email or password." } });
    await expect(signIn({ flow: "signUp", email: "a@b.co", password: "secret123" })).rejects.toMatchObject({
      data: { message: "An account with this email already exists. Sign in instead." },
    });
    // Only plain strings reach the backend's findOne({ email, password }).
    await expect(signIn({ flow: "signIn", email: "a@b.co", password: { $ne: null } })).rejects.toMatchObject({ data: { message: "Enter your email and password." } });
    // The object password never reached the backend: 2 logins (sign-up, wrong password).
    expect(backend.calls.filter((c) => c === "/user/login")).toHaveLength(2);
  });

  it("moves an account made before the switch to the backend and keeps its user", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run((ctx) => ctx.db.insert("users", { email: "boss@x.com", role: "admin", tokenIdentifier: "boss" }));
    const deps = depsFor(t, {
      // The old "password" account: only this email + password match it.
      legacyUser: async (email: string, password: string) => (email === "boss@x.com" && password === "oldpass1" ? { id: admin } : null),
    });
    const { userId } = await authorizeWithBackend({ flow: "signIn", email: "boss@x.com", password: "oldpass1" }, deps);
    expect(userId).toBe(admin);
    expect(backend.users.get("boss@x.com")).toMatchObject({ password: "oldpass1" });
    expect(await t.run((ctx) => ctx.db.get("users", admin))).toMatchObject({ role: "admin" });

    // Someone who registers the admin's email elsewhere can't reach the admin
    // user: their password doesn't match the old account.
    backend.users.delete("boss@x.com");
    const other = await authorizeWithBackend({ flow: "signUp", email: "boss@x.com", password: "attacker1" }, deps);
    expect(other.userId).not.toBe(admin);
    expect(await t.run((ctx) => ctx.db.get("users", other.userId))).toMatchObject({ role: "user" });
  });

  it("keeps a Stripe subscription when the backend says not subscribed, and survives an unreadable subscription", async () => {
    const { t, signIn } = await setup();
    const { userId } = await signIn({ flow: "signUp", email: "pay@x.com", password: "secret123" });
    await t.run((ctx) => ctx.db.patch("users", userId, { plan: "agency", subscriptionStatus: "active", subscriptionId: "sub_1" }));
    await signIn({ flow: "signIn", email: "pay@x.com", password: "secret123" });
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toMatchObject({ plan: "agency", subscriptionStatus: "active" });

    const { userId: again } = await authorizeWithBackend(
      { flow: "signIn", email: "pay@x.com", password: "secret123" },
      depsFor(t, { env: { ADSPY_BACKEND_TOKEN_PREFIX: "wrong__" } }),
    );
    expect(again).toBe(userId);
  });

  it("maps backend plans and reads the user id from the token", () => {
    expect(userIdFromToken(jwt("66f000000000000000000001"))).toBe("66f000000000000000000001");
    expect(userIdFromToken("not-a-token")).toBeNull();
    expect(appPlan({ isSubscribed: false, planName: "Free" })).toEqual({ plan: "none", subscriptionStatus: "canceled" });
    expect(appPlan({ isSubscribed: true, planName: "Pro" }).plan).toBe("pro");
    expect(appPlan({ isSubscribed: true, planName: "Agency" }).plan).toBe("agency");
    expect(appPlan({ isSubscribed: true, planName: "Monthly" }).plan).toBe("starter");
  });

  it("linkAccount never links by email alone", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run((ctx) => ctx.db.insert("users", { email: "boss@x.com", role: "admin", tokenIdentifier: "boss" }));
    const id = await t.mutation(internal.adspyAuth.linkAccount, { backendId: "66f0000000000000000000ff", email: "boss@x.com" });
    expect(id).not.toBe(admin);
  });
});
