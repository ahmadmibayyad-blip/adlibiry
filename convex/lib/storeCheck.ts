// "Ready to sell?" (convex/storeCheck.ts): what still stands between a store and
// its first real order, from what the Admin API shows and what the store's
// launch promised (lib/storeKit.ts StoreFacts). Each item links to where it's
// fixed in Shopify. Payouts can't be read without protected scopes, so that
// one is always a "check it yourself" item.

import { deliveryDays, type StoreFacts } from "./storeKit";

export type CheckStatus = "ok" | "fix" | "check" | "reconnect";
export type StoreCheckItem = { id: string; status: CheckStatus; title: string; detail?: string; fixUrl?: string };

export type ShippingMethod = { name: string; active: boolean; description?: string | null; price?: number; minTotal?: number };
export type ShippingZone = { name: string; countries: string[]; restOfWorld: boolean; methods: ShippingMethod[] };

export type StoreCheckInput = {
  shopDomain: string;
  currency: string;
  country?: string;
  plan?: { name: string; development: boolean } | null;
  /** null: couldn't tell. */
  passwordProtected: boolean | null;
  /** null: no permission to read them. */
  policies: { type: string; body: string }[] | null;
  shipping: ShippingZone[] | null;
  themeCount?: number;
  /** What the store's launch promised (the latest Full store launch). */
  facts?: StoreFacts | null;
  products: { title: string; status: string; hasImage: boolean; bigBrand: boolean }[];
};

export const adminUrl = (shopDomain: string, path: string) => `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, "")}/${path}`;

const money = (n: number, currency: string) => `${Number.isInteger(n) ? n : n.toFixed(2)} ${currency}`;
const range = (d: { min: number; max: number }) => (d.min === d.max ? `${d.max}` : `${d.min}–${d.max}`);

/** Day counts a policy mentions ("14 dage", "30 days", "30-day"), in any of the theme's languages. */
export function policyDays(body: string): number[] {
  const text = body.replace(/<[^>]+>/g, " ");
  const re = /(\d{1,3})\s*-?\s*(?:days?|dag\w*|tag\w*|jours?|d[ií]as|giorni|dni|päivä\w*)\b/gi;
  return [...new Set([...text.matchAll(re)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 365))];
}

export function storeChecks(i: StoreCheckInput): StoreCheckItem[] {
  const out: StoreCheckItem[] = [];
  const admin = (p: string) => adminUrl(i.shopDomain, p);
  const reconnect = (id: string, title: string): StoreCheckItem => ({
    id,
    status: "reconnect",
    title,
    detail: "AdSpy Pro needs permission to read this. Reconnect your store in Settings → Shopify and approve it.",
  });

  // Plan: development and trial stores can't take real orders.
  if (i.plan?.development) {
    out.push({ id: "plan", status: "fix", title: "This is a development store", detail: "Development stores can't take real orders. Use a store on a paid Shopify plan to sell.", fixUrl: admin("settings/plan") });
  } else if (i.plan && /trial/i.test(i.plan.name)) {
    out.push({ id: "plan", status: "fix", title: "Pick a Shopify plan", detail: "Your store is on a trial. Choose a plan so customers can buy.", fixUrl: admin("settings/plan") });
  } else if (i.plan) {
    out.push({ id: "plan", status: "ok", title: `Shopify plan: ${i.plan.name}` });
  }

  if (i.passwordProtected === true) {
    out.push({ id: "password", status: "fix", title: "Your store is password-protected", detail: "Visitors from your ads see a password page. Turn the password off when you're ready.", fixUrl: admin("online_store/preferences") });
  } else if (i.passwordProtected === false) {
    out.push({ id: "password", status: "ok", title: "Your store is open to visitors" });
  }

  out.push({
    id: "payouts",
    status: "check",
    title: "Check payments and payouts",
    detail: "Make sure a payment provider is on and a bank account is added under Payouts, so the money from sales reaches you. Apps can't see this, so check it yourself.",
    fixUrl: admin("settings/payments"),
  });

  // Shipping: rates to the store's own country, the delivery time and the free-shipping amount the store promises.
  if (!i.shipping) {
    out.push(reconnect("shipping", "Shipping couldn't be checked"));
  } else {
    const active = i.shipping.map((z) => ({ ...z, methods: z.methods.filter((m) => m.active) })).filter((z) => z.methods.length);
    const home = i.country ? active.filter((z) => z.countries.includes(i.country!) || z.restOfWorld) : active;
    if (!home.length) {
      out.push({ id: "shipping-rates", status: "fix", title: i.country ? `No shipping rates to ${i.country}` : "No shipping rates", detail: "Customers can't check out without a shipping rate.", fixUrl: admin("settings/shipping") });
    } else {
      out.push({ id: "shipping-rates", status: "ok", title: "Shipping rates are set up" });
      const promised = i.facts?.shippingTime ? deliveryDays(i.facts.shippingTime) : null;
      if (promised) {
        const faster = home
          .flatMap((z) => z.methods)
          .filter((m) => m.price !== 0)
          .map((m) => ({ m, d: m.description ? deliveryDays(m.description) : null }))
          .filter((x): x is { m: ShippingMethod; d: { min: number; max: number } } => !!x.d && x.d.max < promised.min);
        if (faster.length) {
          const f = faster[0];
          out.push({
            id: "delivery-time",
            status: "fix",
            title: "Delivery times don't match",
            detail: `Shopify shows “${f.m.name}” as ${range(f.d)} business days, but your store pages promise ${range(promised)}. Customers expect the faster time, so make them the same.`,
            fixUrl: admin("settings/shipping"),
          });
        } else {
          // Shopify's stable API doesn't show a rate's transit time, so ask.
          out.push({
            id: "delivery-time",
            status: "check",
            title: `Check your delivery times say ${range(promised)} business days`,
            detail: `Your store pages promise ${range(promised)} business days. Make sure no shipping rate in Shopify shows a faster time than your supplier can deliver.`,
            fixUrl: admin("settings/shipping"),
          });
        }
      }
      const free = [...new Set(home.flatMap((z) => z.methods).filter((m) => m.price === 0 && m.minTotal !== undefined).map((m) => m.minTotal!))].sort((a, b) => a - b);
      const want = i.facts?.freeShippingFrom;
      if (want && !free.includes(want)) {
        out.push({
          id: "free-shipping",
          status: "fix",
          title: "Free shipping doesn't match",
          detail: free.length
            ? `Your cart promises free shipping from ${money(want, i.currency)}, but Shopify gives it from ${free.map((n) => money(n, i.currency)).join(" and ")}.`
            : `Your cart promises free shipping from ${money(want, i.currency)}, but Shopify has no free shipping rate for it. Add one with the condition “order price ${money(want, i.currency)} and up”.`,
          fixUrl: admin("settings/shipping"),
        });
      } else if (free.length > 1) {
        out.push({ id: "free-shipping", status: "check", title: "Two free-shipping amounts", detail: `Shopify gives free shipping from ${free.map((n) => money(n, i.currency)).join(" and from ")}. Keep one so the cart and checkout agree.`, fixUrl: admin("settings/shipping") });
      }
    }
  }

  // Policies: the ones checkout links to, and a returns period that matches the store's pages.
  if (!i.policies) {
    out.push(reconnect("policies", "Policies couldn't be checked"));
  } else {
    const body = (type: string) => i.policies!.find((p) => p.type === type)?.body?.trim() ?? "";
    const missing = [
      ["REFUND_POLICY", "Refund"],
      ["PRIVACY_POLICY", "Privacy"],
      ["TERMS_OF_SERVICE", "Terms of service"],
      ["SHIPPING_POLICY", "Shipping"],
    ].filter(([t]) => !body(t)).map(([, label]) => label);
    if (missing.length) {
      out.push({ id: "policies", status: "fix", title: `Missing policies: ${missing.join(", ")}`, detail: "Checkout links to these, and Meta and payment providers expect them. Shopify can write a first version for you.", fixUrl: admin("settings/legal") });
    } else {
      out.push({ id: "policies", status: "ok", title: "Policies are published" });
    }
    const days = i.facts?.returnDays;
    const said = policyDays(body("REFUND_POLICY"));
    if (days && said.length && !said.includes(days)) {
      out.push({
        id: "returns",
        status: "fix",
        title: "Returns period doesn't match",
        detail: `Your refund policy says ${said.join(" or ")} days, but your store pages say ${days} days. Use the same number everywhere.`,
        fixUrl: admin("settings/legal"),
      });
    }
  }

  // The launched products.
  for (const p of i.products) {
    if (p.bigBrand && p.status === "ACTIVE") {
      out.push({ id: `brand:${p.title}`, status: "fix", title: `“${p.title}” is a big-brand product`, detail: "Selling it risks trademark claims and bans on Meta and Shopify. Set it to draft.", fixUrl: admin("products") });
    }
    if (!p.hasImage && p.status === "ACTIVE") {
      out.push({ id: `photo:${p.title}`, status: "fix", title: `“${p.title}” has no photos`, detail: "Visitors see an empty picture. Add photos, or launch it again with AI photos.", fixUrl: admin("products") });
    }
  }

  if (i.themeCount !== undefined && i.themeCount >= 18) {
    out.push({ id: "themes", status: "check", title: `${i.themeCount} of 20 themes used`, detail: "Shopify allows 20 themes. Delete the ones you don't use so new launches can install theirs.", fixUrl: admin("themes") });
  }

  const order: Record<CheckStatus, number> = { fix: 0, reconnect: 1, check: 2, ok: 3 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}
