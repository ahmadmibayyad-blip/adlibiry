import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api.js";
import { Loader2 } from "lucide-react";
import Logo from "@/components/Logo.tsx";
import HideOnError from "@/components/HideOnError.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

type Flow = "signIn" | "signUp";

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const navigate = useNavigate();
  const [flow, setFlow] = useState<Flow>("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (flow === "signUp" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    form.set("flow", flow);
    setBusy(true);
    try {
      // Accounts live on the AdSpy Pro backend (convex/adspyAuth.ts).
      await signIn("adspypro", form);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof ConvexError ? (err.data as { message?: string })?.message : undefined;
      setError(
        message === "Wrong email or password."
          ? flow === "signIn"
            ? "Wrong email or password. New here? Create an account below."
            : message
          : (message ??
              (flow === "signIn"
                ? "Could not sign in. Try again in a minute."
                : "Could not create the account. Check the email and try again.")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex justify-center mb-8" aria-label="AdSpy Pro home">
          <Logo size={28} className="text-xl" />
        </Link>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="font-display text-xl font-bold mb-1">{flow === "signIn" ? "Sign in" : "Create your account"}</h1>
          <p className="text-sm text-muted-foreground mb-5">
            {flow === "signIn" ? "Welcome back." : "Start finding winning products and ads."}
          </p>
          {/* If the backend can't say whether Google is set up, skip the button: email sign-in still works. */}
          <HideOnError>
            <GoogleSignIn onError={setError} />
          </HideOnError>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {flow === "signUp" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" autoComplete="name" placeholder="Your name" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {flow === "signIn" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setError(null);
              setFlow(flow === "signIn" ? "signUp" : "signIn");
            }}
          >
            {flow === "signIn" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleSignIn({ onError }: { onError: (message: string | null) => void }) {
  const { signIn } = useAuthActions();
  const options = useQuery(api.authOptions.get, {});
  const [busy, setBusy] = useState(false);
  if (!options?.google) return null;

  async function withGoogle() {
    onError(null);
    setBusy(true);
    try {
      // Redirects to Google, then back to the app signed in.
      await signIn("google", { redirectTo: "/dashboard" });
    } catch {
      onError("Couldn't start Google sign-in. Try again or use your email.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={withGoogle} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or with email
        <div className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
