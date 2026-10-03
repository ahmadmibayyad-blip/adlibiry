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

export function effectivePlan(user: { role?: string; plan?: string; subscriptionStatus?: string } | null): Plan {
  if (!user) return "none";
  // Admins get full access without going through billing.
  if (user.role === "admin") return "agency";
  if (!user.subscriptionStatus || !ACCESS_STATUSES.has(user.subscriptionStatus)) return "none";
  return user.plan === "starter" || user.plan === "pro" || user.plan === "agency" ? user.plan : "none";
}

// Free and trial accounts see the first 10 results of each list; paying
// customers (active, or past_due while Stripe retries) and admins see all.
export const TRIAL_RESULT_LIMIT = 10;

export function resultLimit(user: { role?: string; plan?: string; subscriptionStatus?: string } | null): number | null {
  if (user?.role === "admin") return null;
  const paying = user?.subscriptionStatus === "active" || user?.subscriptionStatus === "past_due";
  return paying && effectivePlan(user) !== "none" ? null : TRIAL_RESULT_LIMIT;
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
