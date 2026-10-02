import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import type { MutationCtx } from "./_generated/server";
import { upsertAuthUser } from "./lib/authUser";

// Email + password sign-in, plus "Continue with Google" once AUTH_GOOGLE_ID
// and AUTH_GOOGLE_SECRET are set on the deployment. Which user a sign-in
// belongs to (and Google ↔ password account linking): lib/authUser.ts.
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
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
      return await upsertAuthUser(ctx as unknown as MutationCtx, args as Parameters<typeof upsertAuthUser>[1]);
    },
  },
});
