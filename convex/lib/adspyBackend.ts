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

// Routes behind the backend's isUser middleware read
// `authorization: <AUTH_SECRET_KEY><token>` (the key glued to the token, no
// space). The key is the backend's AUTH_SECRET_KEY, set here as the Convex env
// var ADSPY_BACKEND_AUTH_KEY; never commit it. Null when it isn't set.
export function authHeaders(token: string, env: Env): Record<string, string> | null {
  const key = env.ADSPY_BACKEND_AUTH_KEY?.trim();
  return key ? { Authorization: `${key}${token}` } : null;
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
// both with is_subscribed and subscribed_plan. Null when it can't be read:
// ADSPY_BACKEND_AUTH_KEY not set or wrong (401), a backend Admin account
// (isUser only lets role "User" through: 403), or the backend is down.
export async function fetchSubscription(base: string, token: string, env: Env): Promise<BackendSubscription | null> {
  const auth = authHeaders(token, env);
  if (!auth) return null;
  const { status, body } = await call(`${base}/user/checkSubscription`, {
    method: "GET",
    headers: { Accept: "application/json", ...auth },
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

// ── Pro subscription (POST /subscription/pay, POST /subscription/start) ─────

// Pro: €35 a month, or €30 a month billed yearly (€360). Stripe amounts are
// in cents. The backend's /subscription/pay takes the monthly amount and
// multiplies it by 12 for "yearly", so `sendAmount` is what we send and
// `chargeCents` what Stripe actually charges.
export type BillingPeriod = "monthly" | "yearly";
export const PRO_PRICES: Record<BillingPeriod, { sendAmount: number; chargeCents: number; cost: number }> = {
  monthly: { sendAmount: 3500, chargeCents: 3500, cost: 35 },
  yearly: { sendAmount: 3000, chargeCents: 36000, cost: 360 },
};
export const PRO_CURRENCY = "eur";

// The backend creates a Stripe PaymentIntent and returns its client secret.
export async function createPaymentIntent(base: string, token: string, env: Env, period: BillingPeriod): Promise<string> {
  const auth = authHeaders(token, env);
  if (!auth) throw new BackendError("unavailable", "Payments aren't set up yet. Please try again later.");
  const { status, body } = await call(`${base}/subscription/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...auth },
    body: JSON.stringify({ amount: PRO_PRICES[period].sendAmount, subscriptionType: period }),
  });
  if (status === 200 && typeof body.clientSecret === "string" && body.clientSecret) return body.clientSecret;
  if (status === 401 || status === 403 || status === 404) throw new BackendError("invalid", "Please sign out and sign in again, then subscribe.");
  throw new BackendError("unavailable", "Couldn't start the payment. Please try again in a minute.");
}

// Marks the user Pro on the backend after a verified payment. The payment's
// id goes along so the backend can check it too.
export async function startSubscription(
  base: string,
  token: string,
  env: Env,
  period: BillingPeriod,
  paymentIntentId: string,
): Promise<void> {
  const auth = authHeaders(token, env);
  if (!auth) throw new BackendError("unavailable", "Payments aren't set up yet. Please try again later.");
  const { status } = await call(`${base}/subscription/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...auth },
    body: JSON.stringify({ subscriptionType: period, cost: PRO_PRICES[period].cost, paymentIntentId }),
  });
  if (status === 200 || status === 201) return;
  throw new BackendError("unavailable", "Your payment went through, but Pro couldn't be switched on yet. Try again in a minute, or contact support.");
}

export type StripePaymentIntent = { id: string; status: string; amount: number; amount_received?: number; currency: string };

// Reads a PaymentIntent from Stripe with the account's secret key: the browser
// saying "paid" isn't proof. Null when Stripe doesn't know it.
export async function fetchPaymentIntent(secretKey: string, id: string): Promise<StripePaymentIntent | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BackendError("unavailable", "Couldn't reach Stripe to check the payment. Try again in a minute.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new BackendError("unavailable", "Couldn't check the payment with Stripe. Try again in a minute.");
  return (await res.json()) as StripePaymentIntent;
}

// A payment that pays for that period of Pro (a monthly payment can't buy a year).
export function isProPayment(pi: StripePaymentIntent, period: BillingPeriod): boolean {
  return pi.status === "succeeded" && (pi.amount_received ?? pi.amount) >= PRO_PRICES[period].chargeCents && pi.currency === PRO_CURRENCY;
}
