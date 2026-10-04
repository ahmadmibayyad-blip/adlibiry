// Client for the AdSpy Pro backend on Render (accounts and subscriptions).
// Endpoints: POST /user/register, POST /user/login, GET /user/checkSubscription.
// Pure helpers plus fetch calls; convex/adspyAuth.ts uses them to sign people in.

export const DEFAULT_BACKEND_URL = "https://adspypro.onrender.com";

// Render's free instances sleep when idle and take up to ~50 s to wake.
const TIMEOUT_MS = 60_000;

type Env = Record<string, string | undefined>;

export function backendUrl(env: Env): string {
  return (env.ADSPY_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

// How the token is sent to routes behind the backend's isUser middleware.
// Default "Bearer " (Authorization: Bearer <token>); set ADSPY_BACKEND_TOKEN_PREFIX
// to whatever prefix isUser expects. The token also goes in a `token` header.
export function authHeaders(token: string, env: Env): Record<string, string> {
  const prefix = env.ADSPY_BACKEND_TOKEN_PREFIX ?? "Bearer ";
  return { Authorization: `${prefix}${token}`, token };
}

export type BackendErrorCode = "exists" | "invalid" | "unavailable";

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new BackendError("unavailable", "The account server didn't respond. Try again in a minute.");
  }
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON reply: handled by status below */
  }
  return { status: res.status, body: body && typeof body === "object" ? (body as Record<string, unknown>) : {} };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body),
});

export async function registerUser(base: string, u: { userName: string; email: string; password: string }): Promise<void> {
  const { status } = await call(`${base}/user/register`, json({ user_name: u.userName, email: u.email, password: u.password }));
  if (status === 201 || status === 200) return;
  if (status === 409) throw new BackendError("exists", "An account with this email already exists. Sign in instead.");
  throw new BackendError("unavailable", "Could not create the account right now. Try again in a minute.");
}

// Returns the session token. Wrong email or password → BackendError "invalid".
export async function loginUser(base: string, u: { email: string; password: string }): Promise<string> {
  const { status, body } = await call(`${base}/user/login`, json({ email: u.email, password: u.password }));
  if (status === 200 && typeof body.token === "string" && body.token) return body.token;
  if (status === 404 || status === 401 || status === 400) throw new BackendError("invalid", "Wrong email or password.");
  throw new BackendError("unavailable", "Could not sign in right now. Try again in a minute.");
}

// The backend's user id from the token it issued ({ id: user._id }). The token
// comes straight from the backend over HTTPS, so reading it without the
// signing key is safe here; it is never taken from the browser.
export function userIdFromToken(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    const id = payload?.id ?? payload?._id;
    return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type BackendSubscription = { isSubscribed: boolean; planName: string };

// GET /user/checkSubscription answers 200 when subscribed and 404 when not,
// both with is_subscribed and subscribed_plan. Null when it can't be read
// (backend down, or the token header isn't what isUser expects).
export async function fetchSubscription(base: string, token: string, env: Env): Promise<BackendSubscription | null> {
  const { status, body } = await call(`${base}/user/checkSubscription`, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders(token, env) },
  });
  if ((status === 200 || status === 404) && typeof body.is_subscribed === "boolean") {
    return { isSubscribed: body.is_subscribed, planName: typeof body.subscribed_plan === "string" ? body.subscribed_plan : "" };
  }
  return null;
}

// The backend's plan name → the app's plans (lib/billing.ts). Unknown paid
// plan names get the entry plan.
export function appPlan(sub: BackendSubscription): { plan: "starter" | "pro" | "agency" | "none"; subscriptionStatus: string } {
  if (!sub.isSubscribed) return { plan: "none", subscriptionStatus: "canceled" };
  const name = sub.planName.toLowerCase();
  const plan = /agency|business|enterprise/.test(name) ? "agency" : /pro|premium/.test(name) ? "pro" : "starter";
  return { plan, subscriptionStatus: "active" };
}
