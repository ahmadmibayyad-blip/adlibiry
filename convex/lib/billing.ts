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

export type PlanUser = { role?: string; plan?: string; subscriptionStatus?: string; proTrialEndsAt?: number; compProUntil?: number };

// Pro free trial: 7 days of full Pro, no card, once per account (users.proTrialEndsAt).
export const PRO_TRIAL_DAYS = 7;

export function onProTrial(user: PlanUser | null, now = Date.now()): boolean {
  return user?.proTrialEndsAt !== undefined && user.proTrialEndsAt > now;
}

// Free Pro an admin gave (users.compProUntil, e.g. a creator testing the app for a
// video): full Pro like a paying customer, Launch included, until the date. It
// sits next to the backend's plan, so the hourly plan check doesn't undo it.
export const COMP_PRO_DAYS = 30;

export function onCompPro(user: PlanUser | null, now = Date.now()): boolean {
  return user?.compProUntil !== undefined && user.compProUntil > now;
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
  return paid === "none" && (onCompPro(user, now) || onProTrial(user, now)) ? "pro" : paid;
}

// Which allowance an account gets. "trial" is the 7-day Pro trial (or an old
// Stripe "trialing" subscription) before any payment: Pro research, but no
// Launch and smaller daily allowances for what costs us money per use (AI,
// Apify searches, store inspections), see the TRIAL_* limits next to each feature.
export type Tier = "admin" | "paid" | "trial" | "free";

export function tierOf(user: PlanUser | null, now = Date.now()): Tier {
  if (!user) return "free";
  if (user.role === "admin") return "admin";
  if (effectivePlan(user, now) === "none") return "free";
  const paying = (user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due") && paidPlan(user) !== "none";
  return paying || onCompPro(user, now) ? "paid" : "trial";
}

/** The value for the user's tier, e.g. a daily limit. */
export function byTier<T>(user: PlanUser | null, values: Record<Tier, T>, now = Date.now()): T {
  return values[tierOf(user, now)];
}

// Free accounts (and old Stripe "trialing" ones) see the first 10 results of
// each list; paying customers (active, or past_due while Stripe retries),
// accounts on the Pro free trial and admins see all.
export const TRIAL_RESULT_LIMIT = 10;

export function resultLimit(user: PlanUser | null, now = Date.now()): number | null {
  if (user?.role === "admin" || onProTrial(user, now) || onCompPro(user, now)) return null;
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
