import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { stableToken } from "./lib/authIdentity";
import { decryptToken } from "./lib/shopifyOAuth";
import { NoAccess, adminGql as gql } from "./lib/shopifyAdmin";
import { storeChecks, type ShippingZone, type StoreCheckItem } from "./lib/storeCheck";
import type { StoreFacts } from "./lib/storeKit";

// "Ready to sell?": reads the connected store (plan, password, shipping,
// policies, themes and the launched products) and checks it against what the
// latest Full store launch promised. Rules: lib/storeCheck.ts. Shipping and
// policies need read_shipping / read_legal_policies; without them those items
// say to reconnect.

export const context = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", args.token)).unique();
    if (!user) return null;
    const store = await ctx.db.query("shopifyConnections").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    if (!store) return null;
    const launches = (await ctx.db.query("launches").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(100))
      .filter((l) => l.shopDomain === store.shopDomain && l.status === "published" && l.shopifyProductId);
    const facts = (launches.find((l) => l.mode === "store" && l.facts)?.facts as StoreFacts | undefined) ?? null;
    // One row per Shopify product (relaunches update the same one), with the AdSpy product's big-brand flag.
    const seen = new Set<string>();
    const products: { id: string; bigBrand: boolean }[] = [];
    for (const l of launches) {
      if (seen.has(l.shopifyProductId!) || products.length >= 50) continue;
      seen.add(l.shopifyProductId!);
      const p = await ctx.db.get("products", l.productId);
      products.push({ id: l.shopifyProductId!, bigBrand: !!p?.isBigBrand });
    }
    return { shopDomain: store.shopDomain, accessToken: store.accessToken, currency: store.currency ?? "USD", facts, products };
  },
});

/** The query's data, or null when the token lacks the scope. */
async function maybe<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof NoAccess)) throw e;
    console.warn("Store check: no access", e.message.slice(0, 200));
    return null;
  }
}

const SHOP = `{ shop { plan { displayName partnerDevelopment } billingAddress { countryCodeV2 } } themes(first: 50) { nodes { id } } }`;
const POLICIES = `{ shop { shopPolicies { type body } } }`;
const SHIPPING = `{ deliveryProfiles(first: 5) { nodes { profileLocationGroups { locationGroupZones(first: 30) { nodes {
  zone { name countries { code { countryCode restOfWorld } } }
  methodDefinitions(first: 20) { nodes { name active description
    rateProvider { ... on DeliveryRateDefinition { price { amount } } }
    methodConditions { field operator conditionCriteria { __typename ... on MoneyV2 { amount } } } } } } } } } } }`;
// One aliased product() per launched product. featuredImage needs only read_products (media also wants read_files).
const productsQuery = (ids: string[]) =>
  `{ ${ids.map((id, i) => `p${i}: product(id: ${JSON.stringify(id)}) { id title status featuredImage { id } }`).join(" ")} }`;

type ShippingData = {
  deliveryProfiles: { nodes: { profileLocationGroups: { locationGroupZones: { nodes: {
    zone: { name: string; countries: { code: { countryCode: string | null; restOfWorld: boolean } }[] };
    methodDefinitions: { nodes: {
      name: string;
      active: boolean;
      description: string | null;
      rateProvider: { price?: { amount: string } } | null;
      methodConditions: { field: string; operator: string; conditionCriteria: { __typename: string; amount?: string } }[];
    }[] };
  }[] } }[] }[] };
};

export function shippingZones(d: ShippingData): ShippingZone[] {
  return d.deliveryProfiles.nodes.flatMap((p) =>
    p.profileLocationGroups.flatMap((g) =>
      g.locationGroupZones.nodes.map((z) => ({
        name: z.zone.name,
        countries: z.zone.countries.map((c) => c.code.countryCode).filter((c): c is string => !!c),
        restOfWorld: z.zone.countries.some((c) => c.code.restOfWorld),
        methods: z.methodDefinitions.nodes.map((m) => {
          const min = m.methodConditions.find((c) => c.field === "TOTAL_PRICE" && c.operator === "GREATER_THAN_OR_EQUAL_TO" && c.conditionCriteria.amount);
          const price = m.rateProvider?.price ? Number(m.rateProvider.price.amount) : undefined;
          return { name: m.name, active: m.active, description: m.description, ...(price !== undefined ? { price } : {}), ...(min ? { minTotal: Number(min.conditionCriteria.amount) } : {}) };
        }),
      })),
    ),
  );
}

/** true when the storefront shows visitors its password page; null when we can't tell. Follows the redirect to the store's own domain. */
async function passwordProtected(shop: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://${shop}/`, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (/\/password(?:[/?#]|$)/.test(res.url)) return true;
    if (!res.ok) return null;
    return /action=["']\/password["']/.test(await res.text());
  } catch {
    return null;
  }
}

export const run = action({
  args: {},
  handler: async (ctx): Promise<{ shopDomain: string; items: StoreCheckItem[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in first." });
    const c = await ctx.runQuery(internal.storeCheck.context, { token: stableToken(identity) });
    if (!c) throw new ConvexError({ code: "NO_STORE", message: "Connect your Shopify store first (Settings → Shopify)." });
    const token = await decryptToken(c.accessToken, process.env.SHOPIFY_TOKEN_KEY?.trim());
    const shop = c.shopDomain;
    type ShopData = { shop: { plan: { displayName: string; partnerDevelopment: boolean }; billingAddress: { countryCodeV2: string | null } | null }; themes: { nodes: { id: string }[] } };
    type ProductsData = Record<string, { id: string; title: string; status: string; featuredImage: { id: string } | null } | null>;
    const [info, policies, shipping, products, password] = await Promise.all([
      maybe(() => gql<ShopData>(shop, token, SHOP)),
      maybe(() => gql<{ shop: { shopPolicies: { type: string; body: string }[] } }>(shop, token, POLICIES)),
      maybe(() => gql<ShippingData>(shop, token, SHIPPING)),
      c.products.length ? maybe(() => gql<ProductsData>(shop, token, productsQuery(c.products.map((p) => p.id)))) : Promise.resolve({} as ProductsData),
      passwordProtected(shop),
    ]);
    const bigBrand = new Set(c.products.filter((p) => p.bigBrand).map((p) => p.id));
    const items = storeChecks({
      shopDomain: shop,
      currency: c.currency,
      country: info?.shop.billingAddress?.countryCodeV2 ?? undefined,
      plan: info ? { name: info.shop.plan.displayName, development: info.shop.plan.partnerDevelopment } : null,
      passwordProtected: password,
      policies: policies?.shop.shopPolicies ?? null,
      shipping: shipping ? shippingZones(shipping) : null,
      themeCount: info?.themes.nodes.length,
      facts: c.facts,
      products: Object.values(products ?? {})
        .filter((p): p is NonNullable<typeof p> => !!p?.id)
        .map((p) => ({ title: p.title, status: p.status, hasImage: !!p.featuredImage, bigBrand: bigBrand.has(p.id) })),
    });
    return { shopDomain: shop, items };
  },
});
