import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

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
    // Give every new account the stable key the rest of the app looks users up
    // by (see lib/authIdentity.ts), and make the first account — or any email
    // listed in the ADMIN_EMAILS env var — an admin.
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user || user.tokenIdentifier) return;
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const anyAdmin = (await ctx.db.query("users").take(500)).some((u) => u.role === "admin");
      const isAdmin = (user.email && adminEmails.includes(user.email.toLowerCase())) || !anyAdmin;
      await ctx.db.patch(userId, { tokenIdentifier: userId, role: isAdmin ? "admin" : "user" });
    },
  },
});
