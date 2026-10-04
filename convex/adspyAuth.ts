import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { initNewUser } from "./lib/userRole";
import {
  BackendError,
  appPlan,
  backendUrl,
  fetchSubscription,
  loginUser,
  registerUser,
  userIdFromToken,
  type BackendSubscription,
} from "./lib/adspyBackend";

// Email sign-in through the AdSpy Pro backend (lib/adspyBackend.ts). The
// backend owns accounts and subscriptions; this app keeps its own user per
// backend account (role, saved items, alerts), linked by the backend user id
// as the "adspypro" auth account.
//
// Accounts made here before the switch keep working: when the backend doesn't
// know the email but the same email and password match the old account, the
// account is created on the backend with those details and linked to the old
// user (so admins keep their role). Without that password match nothing is
// linked by email: anyone can register any email on the backend.

export const PROVIDER = "adspypro";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (message: string) => new ConvexError({ code: "AUTH", message });

const subscriptionArg = v.object({ isSubscribed: v.boolean(), planName: v.string() });

export const linkedUserId = internalQuery({
  args: { backendId: v.string() },
  handler: async (ctx, args): Promise<Id<"users"> | null> => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", PROVIDER).eq("providerAccountId", args.backendId))
      .unique();
    return account?.userId ?? null;
  },
});

export const linkAccount = internalMutation({
  args: {
    backendId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    legacyUserId: v.optional(v.id("users")),
    subscription: v.optional(subscriptionArg),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", PROVIDER).eq("providerAccountId", args.backendId))
      .unique();
    let userId = account?.userId;
    if (!userId || !(await ctx.db.get("users", userId))) {
      if (account) await ctx.db.delete("authAccounts", account._id);
      userId = args.legacyUserId && (await ctx.db.get("users", args.legacyUserId)) ? args.legacyUserId : undefined;
      if (!userId) {
        userId = await ctx.db.insert("users", { email: args.email, ...(args.name ? { name: args.name } : {}) });
        await initNewUser(ctx, userId);
      }
      await ctx.db.insert("authAccounts", { userId, provider: PROVIDER, providerAccountId: args.backendId });
    }
    const user = (await ctx.db.get("users", userId))!;
    // The backend decides the plan. A Stripe subscription made in this app is
    // left alone when the backend says "not subscribed".
    const plan = args.subscription ? appPlan(args.subscription) : null;
    const applyPlan = plan && (plan.plan !== "none" || !user.subscriptionId);
    await ctx.db.patch("users", userId, {
      ...(!user.email ? { email: args.email } : {}),
      ...(args.name && !user.name ? { name: args.name } : {}),
      ...(applyPlan ? plan : {}),
    });
    if (args.token) await saveBackendToken(ctx, userId, args.token);
    return userId;
  },
});

export async function saveBackendToken(ctx: MutationCtx, userId: Id<"users">, token: string): Promise<void> {
  const row = await ctx.db.query("backendSessions").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (row) await ctx.db.patch("backendSessions", row._id, { token, updatedAt: Date.now() });
  else await ctx.db.insert("backendSessions", { userId, token, updatedAt: Date.now() });
}

type Deps = {
  env: Record<string, string | undefined>;
  runQuery: (fn: FunctionReference<"query", "internal">, args: Record<string, unknown>) => Promise<unknown>;
  runMutation: (fn: FunctionReference<"mutation", "internal">, args: Record<string, unknown>) => Promise<unknown>;
  // The user of an account made here before the switch, if email and password match it.
  legacyUser: (email: string, password: string) => Promise<{ id: Id<"users">; name?: string } | null>;
};

export async function authorizeWithBackend(credentials: Record<string, unknown>, deps: Deps): Promise<{ userId: Id<"users"> }> {
  const flow = credentials.flow === "signUp" ? "signUp" : "signIn";
  // Strings only: the backend looks users up with findOne({ email, password }).
  const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  const name = typeof credentials.name === "string" ? credentials.name.trim().slice(0, 100) : "";
  if (!EMAIL.test(email) || email.length > 200 || !password || password.length > 200) throw fail("Enter your email and password.");
  if (flow === "signUp" && password.length < 8) throw fail("Use at least 8 characters for your password.");

  const base = backendUrl(deps.env);
  try {
    if (flow === "signUp") await registerUser(base, { userName: name || email.split("@")[0], email, password });
    let token: string;
    let legacy: Awaited<ReturnType<Deps["legacyUser"]>> = null;
    try {
      token = await loginUser(base, { email, password });
    } catch (e) {
      if (!(e instanceof BackendError) || e.code !== "invalid" || flow === "signUp") throw e;
      legacy = await deps.legacyUser(email, password);
      if (!legacy) throw e;
      try {
        await registerUser(base, { userName: legacy.name || email.split("@")[0], email, password });
      } catch (registerError) {
        // The email is already on the backend with another password.
        if (registerError instanceof BackendError && registerError.code === "exists") throw e;
        throw registerError;
      }
      token = await loginUser(base, { email, password });
    }

    const backendId = userIdFromToken(token);
    if (!backendId) throw new BackendError("unavailable", "The account server sent an unexpected reply. Try again later.");
    let subscription: BackendSubscription | null = null;
    try {
      subscription = await fetchSubscription(base, token, deps.env);
    } catch {
      /* the plan refreshes on the next sign-in */
    }
    if (!legacy && !(await deps.runQuery(internal.adspyAuth.linkedUserId, { backendId }))) {
      legacy = await deps.legacyUser(email, password);
    }
    const userId = (await deps.runMutation(internal.adspyAuth.linkAccount, {
      backendId,
      email,
      ...(name ? { name } : {}),
      ...(legacy ? { legacyUserId: legacy.id } : {}),
      ...(subscription ? { subscription } : {}),
      token,
    })) as Id<"users">;
    return { userId };
  } catch (e) {
    if (e instanceof BackendError) throw fail(e.message);
    throw e;
  }
}
