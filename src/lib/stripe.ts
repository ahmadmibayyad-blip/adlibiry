import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Stripe publishable key (public by design; the secret key stays on the
// servers). Override per environment with VITE_STRIPE_PUBLISHABLE_KEY.
export const STRIPE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ||
  "pk_live_51SLFHgGZFEMwrk3hh5XdpIVw5V3OD1Mn4Chz9Q5pU8g1vsHMG8QLjhmR51XmJBl40fu3rwb2FCMAHE2iw5jttDlX00dOysY3fL";

// Pro: €35 a month (the server sets the real amount).
export const PRO_PRICE_EUR = 35;

let stripePromise: Promise<Stripe | null> | null = null;
export function getStripe(): Promise<Stripe | null> {
  stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

// Where Stripe sends people back after a payment that needs a redirect
// (bank apps, 3-D Secure); ProReturnHandler finishes the upgrade there.
export const PRO_RETURN_PATH = "/dashboard/settings";
