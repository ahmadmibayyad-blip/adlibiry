import { convexAuth, retrieveAccount } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { ConvexError } from "convex/values";
import Google from "@auth/core/providers/google";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { upsertAuthUser } from "./lib/authUser";
import { PROVIDER, authorizeWithBackend } from "./adspyAuth";
import { internal } from "./_generated/api";

// Email + password sign-in goes through the AdSpy Pro backend on Render
// ("adspypro", convex/adspyAuth.ts). "Continue with Google" shows once
// AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set on the deployment. The old
// "password" provider only signs in accounts made before the switch (and lets
// adspyAuth move them to the backend); new sign-ups go to the backend.
// Which user a Google or old password sign-in belongs to: lib/authUser.ts.
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: PROVIDER,
      authorize: async (credentials, ctx) =>
        await authorizeWithBackend(credentials, {
          env: process.env,
          runQuery: (fn, args) => ctx.runQuery(fn, args),
          runMutation: (fn, args) => ctx.runMutation(fn, args),
          legacyUser: async (email, password) => {
            try {
              const { user } = await retrieveAccount(ctx, { provider: "password", account: { id: email, secret: password } });
              return { id: user._id as Id<"users">, ...(typeof user.name === "string" && user.name ? { name: user.name } : {}) };
            } catch {
              return null;
            }
          },
        }),
    }),
    Password({
      profile(params) {
        if (params.flow === "signUp") throw new ConvexError({ code: "AUTH", message: "Create your account on the sign-in page." });
        const email = String(params.email).trim().toLowerCase();
        const name = typeof params.name === "string" ? params.name.trim() : "";
        const profile: { email: string; name?: string } = { email };
        if (name) profile.name = name;
        return profile as { email: string } & Record<string, string>;
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            profile(p) {
              return { id: p.sub, name: p.name, email: p.email, image: p.picture, emailVerified: p.email_verified === true };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const userId = await upsertAuthUser(ctx as unknown as MutationCtx, args as Parameters<typeof upsertAuthUser>[1]);
      // Google sign-ins get a backend account too (convex/adspyAuth.ts).
      const profile = args.profile as { email?: unknown; name?: unknown; emailVerified?: unknown };
      if (args.type === "oauth" && profile.emailVerified === true && typeof profile.email === "string" && profile.email) {
        await (ctx as unknown as MutationCtx).scheduler.runAfter(0, internal.adspyAuth.syncGoogleAccount, {
          userId,
          email: profile.email.trim().toLowerCase(),
          ...(typeof profile.name === "string" && profile.name.trim() ? { name: profile.name.trim().slice(0, 100) } : {}),
        });
      }
      return userId;
    },
  },
});
