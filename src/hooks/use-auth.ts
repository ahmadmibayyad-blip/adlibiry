import { useCallback, useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

// Same shape the app used from @usehercules/auth: { user.profile.name/email,
// isAuthenticated, isLoading, signin(), signout(), error }.
export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");

  const user = useMemo(
    () =>
      isAuthenticated
        ? {
            id: me?._id,
            profile: {
              name: me?.name ?? me?.email?.split("@")[0] ?? undefined,
              email: me?.email ?? undefined,
            },
          }
        : null,
    [isAuthenticated, me],
  );

  const signin = useCallback(async () => {
    window.location.assign("/login");
  }, []);

  const signout = useCallback(async () => {
    await signOut();
    window.location.assign("/");
  }, [signOut]);

  return {
    user,
    isAuthenticated,
    isLoading: isLoading || (isAuthenticated && me === undefined),
    signin,
    signout,
    error: null as Error | null,
  };
}

export function useUser() {
  return useAuth().user;
}
