import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";

const FLAG_KEY = "adspy-post-login-redirect";

/** Mark that the user just started signing in, so we can route them after auth. */
export function markPendingLoginRedirect() {
  sessionStorage.setItem(FLAG_KEY, "1");
}

/**
 * After the auth callback returns to "/", send freshly signed-in users to the dashboard.
 * Waits for backend auth to be ready so credentials are fully set before navigating.
 */
export function usePostLoginRedirect(target = "/dashboard") {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    if (sessionStorage.getItem(FLAG_KEY) !== "1") return;
    sessionStorage.removeItem(FLAG_KEY);
    navigate(target, { replace: true });
  }, [isAuthenticated, isLoading, navigate, target]);
}
