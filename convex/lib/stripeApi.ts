// Minimal Stripe REST client (fetch + form encoding) for Pro auto-renewal:
// save the card on the first payment, charge it off-session at renewal.
// Uses STRIPE_SECRET_KEY: the same Stripe account as the AdSpy Pro backend,
// with write access to Customers and PaymentIntents.

import type { StripePaymentIntent } from "./adspyBackend";

type Params = Record<string, string | number | boolean | undefined>;

function form(params: Params): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  return body.toString();
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly paymentIntent: StripePaymentIntent | undefined,
  ) {
    super(message);
  }
}

async function post<T>(key: string, path: string, params: Params, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form(params),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string; payment_intent?: StripePaymentIntent } };
  if (!res.ok) {
    throw new StripeApiError(json.error?.message ?? `Stripe ${res.status}`, json.error?.code, json.error?.payment_intent);
  }
  return json as T;
}

export async function createCustomer(key: string, c: { email?: string; name?: string; userId: string }): Promise<string> {
  const customer = await post<{ id: string }>(key, "customers", {
    email: c.email,
    name: c.name,
    "metadata[userId]": c.userId,
  });
  return customer.id;
}

// Before the customer pays: attach the customer and keep the card for later
// charges made without them (renewals).
export async function saveCardOnPayment(key: string, paymentIntentId: string, customerId: string, meta: Params): Promise<void> {
  const metadata: Params = {};
  for (const [k, v] of Object.entries(meta)) metadata[`metadata[${k}]`] = v;
  await post(key, `payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    customer: customerId,
    setup_future_usage: "off_session",
    ...metadata,
  });
}

// Charge a saved card without the customer present. The idempotency key makes
// a retry of the same renewal reuse the first attempt instead of charging twice.
export async function chargeSavedCard(
  key: string,
  c: { customerId: string; paymentMethodId: string; amount: number; currency: string; idempotencyKey: string; meta: Params },
): Promise<StripePaymentIntent> {
  const metadata: Params = {};
  for (const [k, v] of Object.entries(c.meta)) metadata[`metadata[${k}]`] = v;
  return await post<StripePaymentIntent>(
    key,
    "payment_intents",
    {
      amount: c.amount,
      currency: c.currency,
      customer: c.customerId,
      payment_method: c.paymentMethodId,
      off_session: true,
      confirm: true,
      ...metadata,
    },
    c.idempotencyKey,
  );
}
