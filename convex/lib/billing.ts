// Billing rules shared by checkout, the Stripe webhook and plan checks.
// Pure functions: no Stripe calls, so they're unit tested in billing.test.ts.

export type Plan = "agency" | "pro" | "starter" | "none";

// Pricing page variant → the Convex env var holding that Stripe price ID.
export const PRICE_ENV: Record<string, string> = {
  var_starter_monthly: "STRIPE_PRICE_STARTER_MONTHLY",
  var_starter_yearly: "STRIPE_PRICE_STARTER_YEARLY",
  var_pro_monthly: "STRIPE_PRICE_PRO_MONTHLY",
  var_pro_yearly: "STRIPE_PRICE_PRO_YEARLY",
  var_agency_monthly: "STRIPE_PRICE_AGENCY_MONTHLY",
  var_agency_yearly: "STRIPE_PRICE_AGENCY_YEARLY",
};

type Env = Record<string, string | undefined>;

export function priceIdForVariant(variant: string, env: Env): string | undefined {
  const name = PRICE_ENV[variant];
  return name ? env[name]?.trim() || undefined : undefined;
}

// Which plan a Stripe price belongs to, by looking it up in the same env vars.
export function planForPrice(priceId: string | undefined, env: Env): Plan {
  if (!priceId) return "none";
  for (const [variant, name] of Object.entries(PRICE_ENV)) {
    if (env[name]?.trim() === priceId) return variant.split("_")[1] as Plan;
  }
  return "none";
}

// Subscription states that keep access. past_due keeps it while Stripe retries
// the card; canceled, unpaid, incomplete and paused don't.
const ACCESS_STATUSES = new Set(["active", "trialing", "past_due"]);

type PlanUser = { role?: string; plan?: string; subscriptionStatus?: string; proTrialEndsAt?: number };

// Pro free trial: 7 days of full Pro, no card, once per account (users.proTrialEndsAt).
export const PRO_TRIAL_DAYS = 7;

export function onProTrial(user: PlanUser | null, now = Date.now()): boolean {
  return user?.proTrialEndsAt !== undefined && user.proTrialEndsAt > now;
}

function paidPlan(user: PlanUser): Plan {
  if (!user.subscriptionStatus || !ACCESS_STATUSES.has(user.subscriptionStatus)) return "none";
  return user.plan === "starter" || user.plan === "pro" || user.plan === "agency" ? user.plan : "none";
}

export function effectivePlan(user: PlanUser | null, now = Date.now()): Plan {
  if (!user) return "none";
  // Admins get full access without going through billing.
  if (user.role === "admin") return "agency";
  const paid = paidPlan(user);
  return paid === "none" && onProTrial(user, now) ? "pro" : paid;
}

// Free accounts (and old Stripe "trialing" ones) see the first 10 results of
// each list; paying customers (active, or past_due while Stripe retries),
// accounts on the Pro free trial and admins see all.
export const TRIAL_RESULT_LIMIT = 10;

export function resultLimit(user: PlanUser | null, now = Date.now()): number | null {
  if (user?.role === "admin" || onProTrial(user, now)) return null;
  const paying = user?.subscriptionStatus === "active" || user?.subscriptionStatus === "past_due";
  return paying && effectivePlan(user) !== "none" ? null : TRIAL_RESULT_LIMIT;
}

// The app's public address, for links in emails (Convex env SITE_URL).
export function appUrl(): string {
  return (process.env.SITE_URL?.trim() || "https://adspypro.net").replace(/\/+$/, "");
}

// Where Stripe may send people back to: only pages on our own site
// (SITE_URL). Anything else falls back to `fallbackPath` on the site, so a
// crafted checkout link can't bounce a customer to a look-alike page.
export function safeReturnUrl(url: string, siteUrl: string | undefined, fallbackPath: string): string {
  const site = siteUrl?.trim().replace(/\/+$/, "");
  if (!site) return url;
  try {
    if (new URL(url).origin === new URL(site).origin) return url;
  } catch {
    // not a URL: fall through
  }
  return site + fallbackPath;
}
