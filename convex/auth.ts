import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { MutationCtx } from "./_generated/server";
import { initNewUser } from "./lib/userRole";

// Email + password sign-in, handled entirely by this Convex deployment.
// Replaces the Hercules-hosted OIDC login.
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
  ],
  callbacks: {
    // Stable lookup key + role for new accounts — see lib/userRole.ts.
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await initNewUser(ctx as unknown as MutationCtx, userId);
    },
  },
});
