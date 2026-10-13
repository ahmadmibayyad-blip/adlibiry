// Store Teardown (Store Inspector, convex/storeInspector.ts): what a Shopify
// product page shows a shopper, read from its plain HTML and /products/<handle>.js:
// bundle / quantity-break tiers (Kaching Bundles' embedded settings JSON, Upsell
// Koala's server-rendered tiers, Debutify's quantity-break settings, Vitals' volume
// discount from its offers JSON), the review widget's rating and count, price vs
// compare-at, conversion features and the order of the page's sections.
// Everything here is what the page *shows*; none of it is verified. Pure and unit tested.

export type TierDeal =
  | { kind: "none" }
  /** A percentage off the tier's full price. */
  | { kind: "percent"; value: number }
  /** A fixed price for the whole tier, in the store's currency. */
  | { kind: "price"; value: number }
  /** A fixed amount off the tier, in the store's currency. */
  | { kind: "amount"; value: number }
  | { kind: "buyXgetY"; buy: number; get: number }
  /** Several different products sold together. */
  | { kind: "bundle"; items: number };

export type BundleTier = {
  title: string;
  subtitle?: string;
  label?: string;
  badge?: string;
  /** Units the shopper gets (buy + get for "Buy X get Y"). */
  quantity?: number;
  deal: TierDeal;
  /** Our arithmetic: % off vs. buying that many at the single price, when we can tell. */
  percentOff?: number;
  freeGifts: string[];
  freeShipping: boolean;
  preselected: boolean;
};

export type BundleOffer = { app: string; heading?: string; tiers: BundleTier[] };

export type ReviewSummary = {
  /** The review app whose widget showed the numbers, when we know it. */
  app?: string;
  rating?: number;
  count?: number;
  /** Where the numbers came from: the review widget, the page's structured data or the product's review metafield. */
  source: "review widget" | "structured data" | "review metafield";
};

export type PriceInfo = {
  /** In the store's currency (major units). */
  price: number;
  compareAt?: number;
  percentOff?: number;
  currency?: string;
  variants?: number;
};

export type ConversionFeature = { key: string; label: string; evidence?: string };

export type PageSection = { id: string; label: string };

export type Teardown = {
  productPath: string;
  productTitle?: string;
  bundle?: BundleOffer;
  reviews?: ReviewSummary;
  price?: PriceInfo;
  features: ConversionFeature[];
  /** Product template sections, top to bottom (header and footer left out). */
  sections: PageSection[];
};

// ---------------------------------------------------------------- helpers

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The text a shopper can read: no scripts, styles or markup. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const clean = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = decodeEntities(v).replace(/\s+/g, " ").trim();
  return s || undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const FREE_SHIPPING =
  /free (?:worldwide |standard |express |2-day )?(?:shipping|delivery)|gratis (?:fragt|levering|forsendelse|frakt|leverans|versand|lieferung|verzending|bezorging)|fri (?:fragt|frakt|leverans)|kostenlose[rn]? (?:versand|lieferung)|versandkostenfrei|livraison (?:gratuite|offerte)|env[ií]o (?:gratis|gratuito)/i;

// ---------------------------------------------------------------- bundles

type KachingBar = Record<string, unknown>;

/** Kaching Bundles writes each deal block's settings into <script class="kaching-bundles-deal-block-settings">. */
export function kachingBundle(html: string, unitPrice?: number): BundleOffer | undefined {
  const re = /<script[^>]*class="kaching-bundles-deal-block-settings"[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(re)) {
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(m[1]) as Record<string, unknown>;
    } catch {
      continue;
    }
    const bars = Array.isArray(settings.dealBars) ? (settings.dealBars as KachingBar[]) : [];
    if (!bars.length) continue;
    const preselected = settings.preselectedDealBarId;
    // A single-unit tier with its own price is what the bigger tiers are compared with on the page.
    const single = bars.find((b) => num(b.quantity) === 1 && b.dealBarType !== "bxgy" && b.discountType === "specific");
    const reference = num(single?.discountValue) || unitPrice;
    const tiers = bars.slice(0, 8).map((b) => kachingTier(b, b.id === preselected, reference));
    return { app: "Kaching Bundles", ...(clean(settings.blockTitle) ? { heading: clean(settings.blockTitle) } : {}), tiers };
  }
  return undefined;
}

function kachingTier(b: KachingBar, preselected: boolean, unitPrice?: number): BundleTier {
  const type = b.dealBarType;
  let deal: TierDeal = { kind: "none" };
  let quantity = num(b.quantity);
  let paid: number | undefined;
  if (type === "bxgy") {
    const buy = num(b.buyQuantity) ?? 0;
    const get = num(b.getQuantity) ?? 0;
    if (buy > 0 && get > 0) {
      deal = { kind: "buyXgetY", buy, get };
      quantity = buy + get;
      // The "buy" units can have their own fixed price too.
      if (b.buyDiscountType === "specific") paid = num(b.buyDiscountValue);
    }
  } else if (type === "bundle") {
    const items = Array.isArray(b.bundleProducts) ? (b.bundleProducts as { quantity?: unknown }[]) : [];
    const count = items.reduce((s, p) => s + (num(p.quantity) ?? 1), 0);
    deal = { kind: "bundle", items: count };
    quantity = count || undefined;
  } else {
    const value = num(b.discountValue);
    if (value !== undefined && value > 0) {
      if (b.discountType === "percentage") deal = { kind: "percent", value };
      else if (b.discountType === "specific") deal = { kind: "price", value };
      else if (b.discountType === "amount") deal = { kind: "amount", value };
    }
  }
  const gifts = (Array.isArray(b.freeGifts) ? (b.freeGifts as Record<string, unknown>[]) : [])
    .map((g) => clean(g.text) ?? clean(g.title))
    .filter((t): t is string => !!t)
    .map((t) => t.replace(/^\+\s*/, ""));
  const percentOff = tierPercentOff(deal, quantity, unitPrice, paid);
  const fill = (v: unknown) => {
    const s = clean(v);
    if (!s) return undefined;
    // Kaching fills {{saved_percentage}} and friends in the browser. We fill the percentage when we
    // can work it out and otherwise leave the line out rather than show half a sentence.
    const out = s.replace(/\{\{\s*saved_percentage\s*\}\}/g, percentOff !== undefined ? `${Math.round(percentOff)}%` : "{{?}}");
    return /\{\{[^}]*\}\}/.test(out) ? undefined : out;
  };
  const title = fill(b.title) ?? (quantity ? `${quantity}×` : "Tier");
  const subtitle = fill(b.subtitle);
  const label = fill(b.label);
  const badge = fill(b.badgeText);
  // Free shipping is often a "gift" line, a subtitle or a badge.
  const freeShipping = [subtitle, label, badge, ...gifts].some((t) => !!t && FREE_SHIPPING.test(t));
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(label ? { label } : {}),
    ...(badge ? { badge } : {}),
    ...(quantity ? { quantity } : {}),
    deal,
    ...(percentOff !== undefined ? { percentOff } : {}),
    freeGifts: gifts.filter((g) => !FREE_SHIPPING.test(g)),
    freeShipping,
    preselected,
  };
}

/** % off vs. buying the tier's units at the single price. */
function tierPercentOff(deal: TierDeal, quantity: number | undefined, unitPrice: number | undefined, buyPrice?: number): number | undefined {
  const versusSingle = (paid: number) => {
    if (!unitPrice || !quantity) return undefined;
    const off = (1 - paid / (unitPrice * quantity)) * 100;
    return off > 0.5 && off < 100 ? round1(off) : undefined;
  };
  switch (deal.kind) {
    case "percent":
      return round1(deal.value);
    case "buyXgetY":
      return buyPrice !== undefined ? versusSingle(buyPrice) : round1((deal.get / (deal.buy + deal.get)) * 100);
    case "price":
      return quantity && quantity > 1 ? versusSingle(deal.value) : undefined;
    case "amount":
      return unitPrice && quantity ? versusSingle(unitPrice * quantity - deal.value) : undefined;
    default:
      return undefined;
  }
}

/** Upsell Koala renders its quantity-break tiers into the page. */
export function koalaBundle(html: string): BundleOffer | undefined {
  const parts = html.split(/<li[^>]*class="koala-deal__tiers__list-item[^"]*"[^>]*>/).slice(1);
  if (!parts.length) return undefined;
  const tiers: BundleTier[] = [];
  for (const raw of parts.slice(0, 8)) {
    const part = raw.split(/<\/label>\s*<\/li>/)[0];
    const pick = (cls: string) => clean(part.match(new RegExp(`class="${cls}[^"]*"[^>]*data-template="([^"]*)"`))?.[1]);
    const title = pick("koala-deal__tier__title");
    if (!title) continue;
    const subtitle = pick("koala-deal__tier__subtitle");
    const badge = clean(part.match(/koala-ribbon[^>]*>\s*<span[^>]*data-template="([^"]*)"/)?.[1]);
    const groups = part.match(/koala-deal__tier__variant-group-number/g)?.length;
    const quantity = num(title.match(/\d+/)?.[0]) ?? groups;
    tiers.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(badge ? { badge } : {}),
      ...(quantity ? { quantity } : {}),
      deal: { kind: "none" },
      freeGifts: [],
      freeShipping: [subtitle, badge].some((t) => !!t && FREE_SHIPPING.test(t)),
      preselected: /<input[^>]*\bchecked\b/.test(part),
    });
  }
  return tiers.length ? { app: "Upsell Koala", tiers } : undefined;
}

const parseJson = (s: string | undefined): unknown => {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
};

/** The JSON object literal that starts at s[start] ("{"), read up to its matching brace. */
function jsonObjectAt(s: string, start: number): unknown {
  if (s[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length && i < start + 200_000; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return parseJson(s.slice(start, i + 1));
  }
  return undefined;
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(asRecord).filter((x): x is Record<string, unknown> => !!x) : [];

/** Fills {{ name }} / {NAME} placeholders we know; a line with one we can't fill is left out. */
function fillTemplate(v: unknown, values: Record<string, string | undefined>): string | undefined {
  const s = clean(v);
  if (!s) return undefined;
  const out = s
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k.toLowerCase()] ?? m)
    .replace(/\{(\w+)\}/g, (m, k: string) => values[k.toLowerCase()] ?? m);
  return /\{\{?\s*\w+\s*\}?\}/.test(out) ? undefined : out;
}

/**
 * Vitals keeps a product's offers (volume discounts, bundles…) on its own server and loads them in the
 * browser; the page only carries what's needed to ask for them (its app embed's vtlsLiquidData). This is
 * the plain JSON URL the widget reads, when the store has a volume discount set up (ubOfferTypes["2"]).
 */
export function vitalsOffersUrl(html: string, productId?: number): string | undefined {
  if (!html.includes("vtlsLiquidData")) return undefined;
  const m = html.match(/vtlsLiquidData\.ubOfferTypes\s*=\s*(?=\{)/);
  const types = m ? asRecord(jsonObjectAt(html, (m.index ?? 0) + m[0].length)) : undefined;
  if (!types?.["2"]) return undefined;
  const shop = html.match(/vtlsLiquidData\.shopInfo\s*=\s*\{\s*id:\s*(\d+)/)?.[1];
  const cacheKey = html.match(/vtlsLiquidData\.cacheKeys\s*=\s*\[([^\]]*)\]/)?.[1].split(",")[3]?.trim();
  const id = productId ?? num(html.match(/vtlsLiquidData\.product\s*=\s*\{\s*"id":\s*(\d+)/)?.[1]);
  if (!shop || !cacheKey || !/^\d+$/.test(cacheKey) || !id) return undefined;
  const locale = html.match(/Shopify\.locale\s*=\s*"([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)"/)?.[1] ?? "en";
  const country = html.match(/Shopify\.country\s*=\s*"([A-Z]{2})"/)?.[1] ?? "US";
  return `https://appsolve.io/bundle/api/v2/sf/ub/pp/${shop}/${locale}/${cacheKey}/${country}/${id}.json`;
}

/** Vitals' volume discount for the product, from the offers JSON at vitalsOffersUrl(). */
export function vitalsBundle(offers: unknown, unitPrice?: number): BundleOffer | undefined {
  const vd = asRecord(asRecord(asRecord(offers)?.volumeDiscount)?.vd);
  if (!vd) return undefined;
  const raw = asList(vd.tiersWithGifts).filter((t) => (num(t.tierQuantity) ?? 0) > 0);
  if (!raw.length) return undefined;
  // Vitals sorts tiers by quantity and shows ranges like "10 - 19" and "30+".
  const order = raw.map((t, i) => ({ t, i })).sort((a, b) => num(a.t.tierQuantity)! - num(b.t.tierQuantity)!);
  const formats = Array.isArray(vd.discountFormatTierLabels) ? (vd.discountFormatTierLabels as unknown[]) : [];
  const highlight = num(vd.highlightTier);
  const tiers = order.slice(0, 8).map(({ t, i }, k): BundleTier => {
    const quantity = num(t.tierQuantity)!;
    const next = num(order[k + 1]?.t.tierQuantity);
    const interval = next === undefined ? `${quantity}+` : next - 1 > quantity ? `${quantity} - ${next - 1}` : `${quantity}`;
    const type = typeof t.discountType === "string" ? t.discountType : "percent";
    const value = num(t.discountValue) ?? 0;
    let deal: TierDeal = { kind: "none" };
    if (value > 0) {
      if (type === "percent") deal = { kind: "percent", value };
      // "fixed" takes an amount off each item; "fixed_price" sets the tier's total.
      else if (type === "fixed") deal = { kind: "amount", value: Math.round(value * quantity * 100) / 100 };
      else if (type === "fixed_price") deal = { kind: "price", value };
    }
    const percentOff = tierPercentOff(deal, quantity, unitPrice);
    const values = {
      quantity: String(quantity),
      quantity_interval: interval,
      discount_amount: deal.kind === "percent" ? `${value}%` : undefined,
      saved_percentage: percentOff !== undefined ? `${Math.round(percentOff)}%` : undefined,
    };
    const format = asRecord(formats[i]);
    const isHighlighted = highlight === i + 1;
    const title =
      fillTemplate(format?.title, values) ??
      fillTemplate(deal.kind === "none" ? vd.discountFormatTextTierZero : vd.discountFormatText, values) ??
      `Buy ${interval}`;
    const subtitle = fillTemplate(format?.subtitle, values);
    // Vitals' "label" is the ribbon over a tier ("MOST POPULAR"); its "badge" is a pill like "Save: £4.48".
    const badge = fillTemplate(format?.label, values) ?? (isHighlighted ? clean(vd.highlightTierLabel) : undefined);
    const label = fillTemplate(format?.badge, values);
    const gifts = asList(t.giftGroups).map((g) => clean(g.textBefore) ?? clean(g.textAfter) ?? "Free gift");
    return {
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(label ? { label } : {}),
      ...(badge ? { badge } : {}),
      quantity,
      deal,
      ...(percentOff !== undefined ? { percentOff } : {}),
      freeGifts: gifts.filter((g) => !FREE_SHIPPING.test(g)),
      freeShipping: [title, subtitle, label, badge, ...gifts].some((s) => !!s && FREE_SHIPPING.test(s)),
      preselected: t.selectedByDefault === true || (vd.preselectHighlightedTier === true && isHighlighted),
    };
  });
  const heading = clean(vd.title);
  return { app: "Vitals", ...(heading ? { heading } : {}), tiers };
}

/** The product fields Debutify's quantity breaks are targeted by. */
type DebutifyProduct = { handle?: string; type?: string; tags: string[]; collections: string[] };

/**
 * Debutify themes (8.x) print the quantity-break widget's settings into the page as
 * Debutify.widgets['qty-breaks'] plus one product_break.push({...}) per group and a
 * `var block_setting = {...}` per break; the theme's script draws the tiers from them in the browser
 * inside <dbtfy-product-quantity-break>, which also holds the product and its collections as JSON.
 */
export function debutifyBundle(html: string, productJs?: unknown, unitPrice?: number): BundleOffer | undefined {
  // The settings are on every page; the tiers only show where the product template has the widget.
  if (!html.includes("Debutify.widgets['qty-breaks']") || !html.includes("<dbtfy-product-quantity-break")) return undefined;
  const at = (m: RegExpMatchArray | null) => (m ? asRecord(jsonObjectAt(html, (m.index ?? 0) + m[0].length)) : undefined);
  const settings = at(html.match(/Debutify\.widgets\['qty-breaks'\]\s*=\s*(?=\{)/));
  if (!settings || settings.enable_quantity_breaks === false) return undefined;
  // Groups in page order, each with the breaks that follow it.
  const groups: { group: Record<string, unknown>; breaks: Record<string, unknown>[] }[] = [];
  for (const m of html.matchAll(/\['product_break'\]\.push\(\s*(?=\{)|var block_setting\s*=\s*(?=\{)|block_setting\.free_product\s*=\s*(?=\{)/g)) {
    const obj = at(m);
    const breaks = groups[groups.length - 1]?.breaks;
    if (!obj) continue;
    if (m[0].startsWith("[")) groups.push({ group: obj, breaks: [] });
    else if (m[0].includes("free_product")) {
      // The free product as Liquid printed it: the product's JSON, or an error object when it doesn't exist.
      if (breaks?.length) breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], free_product: obj };
    } else if (breaks && obj.product_break_range !== undefined) breaks.push(obj);
  }
  if (!groups.length) return undefined;
  const product = debutifyProduct(html, productJs);
  const shown = groups.filter(({ group }) => debutifyGroupShows(group, product)).flatMap((g) => g.breaks);
  const breaks = shown.filter((b) => (num(b.product_break_range) ?? 0) > 0).sort((a, b) => num(a.product_break_range)! - num(b.product_break_range)!);
  if (!breaks.length) return undefined;
  const tiers: BundleTier[] = [];
  // The single-unit option the theme adds first (and selects) when "enable single quantity" is on.
  if (settings.enable_single_quantity === true) {
    const title = fillTemplate(settings.single_quantity_text, { count: "1" }) ?? "1×";
    tiers.push({ title, quantity: 1, deal: { kind: "none" }, freeGifts: [], freeShipping: FREE_SHIPPING.test(title), preselected: true });
  }
  for (const b of breaks.slice(0, 8)) {
    const quantity = num(b.product_break_range)!;
    // The theme reads the amount like parseFloat: "10OFF" is 10.
    const value = num(String(b.product_break_discount_amount ?? "").match(/^\s*\d+(?:\.\d+)?/)?.[0]) ?? 0;
    let deal: TierDeal = { kind: "none" };
    // "%" takes a percentage off; otherwise the amount comes off each item.
    if (value > 0) deal = b.product_break_discount_type === "%" ? { kind: "percent", value } : { kind: "amount", value: Math.round(value * quantity * 100) / 100 };
    const percentOff = tierPercentOff(deal, quantity, unitPrice);
    const values = { count: String(quantity) };
    const title = fillTemplate(clean(b.title) ? b.title : settings.multiple_quantity_text, values) ?? `${quantity}×`;
    // The tiers show the widget's shared subtext ("You have saved {SAVED_AMOUNT}"), not the block's subtitle.
    const subtitle = fillTemplate(settings.multiple_quantity_subtext, values);
    const label = fillTemplate(b.product_break_tag_1, values);
    const badge = b.product_break_badge_style === "most_popular" ? "Most popular" : clean(b.badge_title);
    // The theme shows the free product only when it exists and is for sale.
    const free = asRecord(b.free_product);
    const gift = free && free.available !== false ? clean(free.title) : undefined;
    const giftQty = num(b.product_break_free_product_quantity) ?? 1;
    const gifts = gift ? [`${giftQty > 1 ? `${giftQty} × ` : ""}${gift}`] : [];
    tiers.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(label ? { label } : {}),
      ...(badge ? { badge } : {}),
      quantity,
      deal,
      ...(percentOff !== undefined ? { percentOff } : {}),
      freeGifts: gifts,
      freeShipping: [title, subtitle, label, badge].some((s) => !!s && FREE_SHIPPING.test(s)),
      preselected: false,
    });
  }
  // The widget's "heading" setting isn't shown on the product page.
  return { app: "Debutify", tiers };
}

function debutifyProduct(html: string, productJs?: unknown): DebutifyProduct {
  const fromPage = asRecord(parseJson(html.match(/<script[^>]*data-quantity-break-product[^>]*>([\s\S]*?)<\/script>/)?.[1]));
  const p = fromPage ?? asRecord(productJs);
  const tags = Array.isArray(p?.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === "string") : typeof p?.tags === "string" ? p.tags.split(",").map((t) => t.trim()) : [];
  const collections = asList(parseJson(html.match(/<script[^>]*data-quantity-break-collection[^>]*>([\s\S]*?)<\/script>/)?.[1]))
    .map((c) => c.handle)
    .filter((h): h is string => typeof h === "string");
  return { handle: typeof p?.handle === "string" ? p.handle : undefined, type: typeof p?.type === "string" ? p.type : undefined, tags, collections };
}

/** Debutify's own rule for which break groups a product shows. */
function debutifyGroupShows(group: Record<string, unknown>, product: DebutifyProduct): boolean {
  const str = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");
  switch (group.product_break_visibility) {
    case "all":
      return true;
    case "collection":
      return product.collections.includes(String(group.product_break_collection));
    case "type":
      return product.type !== undefined && str(group.product_break_types).includes(product.type.toLowerCase());
    case "tag":
      return product.tags.some((t) => str(group.product_break_tags).includes(t.toLowerCase()));
    case "product":
      return !!product.handle && group.product_break_product === product.handle;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- reviews

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}=['"]([^'"]*)['"]`))?.[1];

function plausible(r: ReviewSummary): ReviewSummary | undefined {
  const rating = r.rating !== undefined && r.rating > 0 && r.rating <= 5 ? Math.round(r.rating * 100) / 100 : undefined;
  const count = r.count !== undefined && r.count > 0 && r.count < 50_000_000 ? Math.round(r.count) : undefined;
  if (rating === undefined && count === undefined) return undefined;
  return { ...(r.app ? { app: r.app } : {}), ...(rating !== undefined ? { rating } : {}), ...(count !== undefined ? { count } : {}), source: r.source };
}

/** The rating and review count the product page shows, preferring the review app's own widget. */
export function reviewSummary(html: string, productId?: number): ReviewSummary | undefined {
  // Judge.me preview badge.
  const jdgm = html.match(/<[^>]*class=['"]jdgm-prev-badge['"][^>]*>/)?.[0];
  if (jdgm) {
    const r = plausible({ app: "Judge.me", rating: num(attr(jdgm, "data-average-rating")), count: num(attr(jdgm, "data-number-of-reviews")), source: "review widget" });
    if (r) return r;
  }
  // Loox star rating: the one for this product when the page has several.
  const loox = [...html.matchAll(/<[a-z-]+\s[^>]*\bdata-raters="\d+"[^>]*>/g)].map((m) => m[0]).filter((t) => /loox/i.test(t));
  const looxTag = loox.find((t) => productId !== undefined && attr(t, "data-id") === String(productId)) ?? loox[0];
  if (looxTag) {
    const r = plausible({ app: "Loox", rating: num(attr(looxTag, "data-rating")), count: num(attr(looxTag, "data-raters")), source: "review widget" });
    if (r) return r;
  }
  // Okendo star rating snippet.
  const oke = html.match(/data-oke-metafield-data[^>]*>\s*(\{"averageRating":[^<]*\})\s*</)?.[1];
  if (oke) {
    try {
      const j = JSON.parse(oke) as Record<string, unknown>;
      const r = plausible({ app: "Okendo", rating: num(j.averageRating), count: num(j.reviewCount), source: "review widget" });
      if (r) return r;
    } catch {
      /* fall through */
    }
  }
  // The page's schema.org Product data.
  const ld = html.match(/"aggregateRating"\s*:\s*\{[^}]*\}/)?.[0];
  if (ld) {
    const r = plausible({
      rating: num(ld.match(/"ratingValue"\s*:\s*"?([\d.]+)/)?.[1]),
      count: num(ld.match(/"(?:reviewCount|ratingCount)"\s*:\s*"?(\d+)/)?.[1]),
      source: "structured data",
    });
    if (r) return r;
  }
  // Shopify's standard reviews metafields (reviews.rating / reviews.rating_count), which themes and Klaviyo print.
  const meta = html.match(/"rating"\s*:\s*\{[^{}]*"value"\s*:\s*"([\d.]+)"[^{}]*\}\s*,\s*"rating_count"\s*:\s*(\d+)/);
  if (meta) return plausible({ rating: num(meta[1]), count: num(meta[2]), source: "review metafield" });
  return undefined;
}

// ---------------------------------------------------------------- price

/** Price and compare-at from /products/<handle>.js (amounts in cents). */
export function productPrice(productJs: unknown, currency?: string): PriceInfo | undefined {
  if (!productJs || typeof productJs !== "object") return undefined;
  const p = productJs as Record<string, unknown>;
  const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : [];
  // The cheapest variant on sale, else the product's own price.
  const available = variants.filter((v) => v.available !== false && num(v.price) !== undefined);
  const cheapest = available.sort((a, b) => num(a.price)! - num(b.price)!)[0];
  const cents = num(cheapest?.price) ?? num(p.price);
  if (cents === undefined || cents <= 0) return undefined;
  const compareCents = num(cheapest?.compare_at_price) ?? num(p.compare_at_price);
  const price = cents / 100;
  const compareAt = compareCents && compareCents > cents ? compareCents / 100 : undefined;
  return {
    price,
    ...(compareAt ? { compareAt, percentOff: Math.round((1 - price / compareAt) * 100) } : {}),
    ...(currency ? { currency } : {}),
    ...(variants.length ? { variants: variants.length } : {}),
  };
}

// ---------------------------------------------------------------- sections

const SECTION_LABELS: [RegExp, string][] = [
  [/(^|_)main($|[-_])|main[-_]product|product[-_]template/, "Buy box"],
  [/sticky/, "Sticky add-to-cart"],
  [/compar|(^|_)vs(_|$)|versus/, "Comparison"],
  [/faq|accordion|collapsible/, "FAQ / accordion"],
  [/testimonial|quote/, "Testimonials"],
  [/review|loox|judge|jdgm|okendo|trustoo|stamped|yotpo/, "Reviews"],
  [/guarantee|garanti/, "Guarantee"],
  [/stat|progress|percent|result|number/, "Stats / results"],
  [/video|shoppable|ugc|tiktok/, "Video"],
  [/image[-_]?with[-_]?text|images?[-_]with[-_]text|image[-_]text|media[-_]text|feature[-_]row/, "Image with text"],
  [/slideshow|slider|carousel|gallery/, "Slideshow / gallery"],
  [/multi[-_]?column|icon|usp|feature|benefit|trust/, "Benefits / icons"],
  [/related|recommend|featured[-_]collection|upsell|you[-_]may/, "Related products"],
  [/banner|hero/, "Banner"],
  [/rich[-_]text|text/, "Text"],
  [/newsletter|email|signup/, "Newsletter"],
  [/custom[-_]liquid|custom[-_]html/, "Custom code"],
  [/^gp[-_]section/, "GemPages section"],
  [/pagefly|^pf[-_]/, "PageFly section"],
  [/replo/, "Replo section"],
];

function sectionLabel(name: string, chunk: string): string {
  const n = name.toLowerCase().replace(/_[A-Za-z0-9]{6}$/, "");
  // App sections ("apps", or a timestamp-style id) are named after the app block inside them.
  const appSection = /^\d{10}[0-9a-f]{6,10}$/.test(n) || /shopify-section--apps\b/.test(chunk.slice(0, 400));
  if (appSection) {
    const block = chunk.match(/id="shopify-block-[^"_]*__([a-z0-9_]+?)_[A-Za-z0-9]{6}"/)?.[1] ?? "";
    for (const [re, label] of SECTION_LABELS) if (block && re.test(block)) return `${label} (app)`;
    return "App section";
  }
  for (const [re, label] of SECTION_LABELS) if (re.test(n)) return label;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(n)) return "Custom section";
  return n.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The product template's sections in page order, from Shopify's shopify-section-template--<id>__<name> ids. */
export function sectionOrder(html: string): PageSection[] {
  const starts = [...html.matchAll(/<(?:div|section)[^>]*\bid="shopify-section-(template--\d+__[^"]+)"/g)].map((m) => ({ at: m.index ?? 0, id: m[1] }));
  return starts.slice(0, 40).map((s, i) => {
    const name = s.id.split("__").slice(1).join("__");
    const chunk = html.slice(s.at, starts[i + 1]?.at ?? s.at + 20_000);
    return { id: name, label: sectionLabel(name, chunk) };
  });
}

// ---------------------------------------------------------------- conversion features

type FeatureRule = { key: string; label: string; text?: RegExp; html?: RegExp };

const FEATURES: FeatureRule[] = [
  // Kaching's own sticky-bar setting, or a theme/app element named like one.
  { key: "sticky_atc", label: "Sticky add-to-cart", html: /"stickyAtcEnabled":true|(?:class|id)="[^"]*sticky[-_]?(?:atc|add[-_]?to[-_]?cart|addtocart)/i },
  { key: "countdown", label: "Countdown timer", html: /(?:class|id)="[^"]*count[-_]?down[^"]*"|<countdown-timer\b|class="[^"]*\btimer-box\b/i },
  {
    key: "ends_today",
    label: "“Ends today” / last-chance text",
    text: /ends today|today only|only today|last (?:day|chance)|kun i dag|slutter i dag|sidste (?:chance|dag)|endast idag|bara idag|sista (?:chansen|dagen)|siste (?:sjanse|dag)|nur heute|heute nur|letzter tag|endet heute|alleen vandaag|laatste (?:kans|dag)|aujourd'hui seulement|dernier jour|derni[eè]re chance|s[oó]lo hoy|[uú]ltimo d[ií]a|[uú]ltima oportunidad/i,
  },
  {
    key: "low_stock",
    label: "Low-stock / scarcity text",
    text: /only \d+ left|\d+ left in stock|low stock|almost sold out|selling fast|nur noch \d+|kun \d+ (?:tilbage|igjen|p[åa] lager)|bara \d+ kvar|endast \d+ kvar|nog (?:maar )?\d+ (?:op voorraad|beschikbaar|over)|plus que \d+|solo quedan \d+|\d{2}% (?:sold|udsolgt|solgt|verkauft|s[åa]lt|uitverkocht)|f[åa] p[åa] lager|vorrat ist begrenzt|begrenzter vorrat|begr[æa]nset (?:lager|antal)|limited stock|stock limit[ée]/i,
  },
  {
    key: "guarantee",
    label: "Money-back guarantee",
    text: /money[- ]back|satisfaction guarantee|\d+[- ]day(?:s)? (?:\w+ )?guarantee|risk[- ]free|pengene tilbage|pengarna tillbaka|pengene tilbake|geld[- ]zur[üu]ck|niet goed,? geld terug|satisfait ou rembours[ée]|garantie de remboursement|devoluci[oó]n del dinero|\d+[- ]?(?:dages|dagars|dagers|tage|dagen|jours|d[ií]as)[- ](?:\w+[- ])?(?:garanti|garantie|returret|r[üu]ckgabe)|tilfredshedsgaranti|n[öo]jd[- ]kund[- ]garanti|zufriedenheitsgarantie|tevredenheidsgarantie|risikofri|risikofrei|risicovrij/i,
  },
  { key: "pay_later", label: "Klarna / pay-later messaging", html: /klarna-placement|klarna-on-site|<klarna-|shopify-payment-terms|afterpay-placement|<afterpay-|paypal-message|data-pp-message/i, text: /\bklarna\b|afterpay|clearpay|pay in 4|betal senere|betala senare|sp[äa]ter bezahlen|achteraf betalen/i },
  {
    key: "comparison",
    label: "Comparison table (us vs. others)",
    text: /\bus vs\.?|\bvs\.? (?:others|competitors|the rest)|comparison(?! of)|other brands|andre m[æa]rker|andra m[äa]rken|vergleich|andere marken|vergelijk|andere merken|comparatif|autres marques|comparaci[oó]n|otras marcas/i,
  },
  {
    key: "faq",
    label: "FAQ",
    text: /frequently asked|ofte stillede|h[äa]ufig gestellte|h[äa]ufige fragen|vanliga fr[åa]gor|ofte stilte|veelgestelde|veel gestelde|questions fr[ée]quentes|preguntas frecuentes/i,
    html: /<h[1-6][^>]*>\s*(?:<[^>]+>\s*)*(?:faq|fragen|sp[øo]rgsm[åa]l|fr[åa]gor|vragen)/i,
  },
  { key: "free_shipping", label: "Free shipping message", text: FREE_SHIPPING },
  {
    key: "shipping_bar",
    label: "Free-shipping progress bar",
    html: /free[-_ ]?shipping[-_ ]?(?:bar|progress|goal)|shipping[-_]bar|hextom/i,
    text: /away from free (?:shipping|delivery)|fra gratis fragt|bis zum kostenlosen versand|kvar till fri frakt|tot gratis verzending/i,
  },
  {
    key: "delivery_date",
    label: "Delivery estimate",
    text: /(?:estimated|expected) delivery|delivered (?:by|between|on)|arrives (?:by|between)|ships (?:by|today|within)|forventet levering|leveres (?:mellem|den|inden)|lieferung (?:am|zwischen|bis)|bei dir (?:am|zwischen)|leverans (?:mellan|den)|levert (?:mellom|innen)|bezorgd (?:op|tussen)|morgen in huis|in \d+[-–]\d+ (?:werktagen|hverdage|arbetsdagar|virkedager|werkdagen|business days|working days)|bestil inden|best[äa]ll f[öo]re|besteld? voor|order (?:before|by|within) \d/i,
  },
  {
    key: "free_gift",
    label: "Free gift",
    text: /free gift|gratis (?:gave|gaven|geschenk|g[åa]va|cadeau|cadeautje)|geschenk gratis|[üu]berraschungsgeschenk|cadeau offert|regalo gratis|free e-?book|gratis e-?book/i,
  },
  {
    key: "customer_claim",
    label: "Customer-count claim",
    text: /\d[\d.,' ]*\d\+?\s*(?:happy|satisfied|tilfredse|glade|zufriedene|gl[üu]ckliche|n[öo]jda|forn[øo]yde|tevreden|clients satisfaits|clientes satisfechos)\b|(?:over|more than|mehr als|[üu]ber|mer [äa]n|meer dan|plus de|m[áa]s de)\s*\d[\d.,']*\+?\s*(?:customers|kunder|kunden|klanten|clients|clientes|sold|solgte|verkauft|s[åa]lda|verkocht|vendus)/i,
  },
  {
    key: "live_viewers",
    label: "“People viewing now”",
    text: /\d+ (?:people|personer|personen|mensen|personnes|personas) (?:are )?(?:viewing|looking|ser p[åa]|tittar|sehen|bekijken|kijken|regardent|est[áa]n viendo)/i,
  },
  { key: "payment_icons", label: "Payment / trust badges", html: /payment[-_]icons?\b|icon--payment|trust[-_ ]?badge|secure[-_ ]checkout/i },
  { key: "video", label: "Video on the page", html: /<video\b|youtube\.com\/embed|player\.vimeo\.com/i },
];

const snippet = (text: string, re: RegExp) => {
  const m = re.exec(text);
  if (!m) return undefined;
  const start = Math.max(0, m.index - 30);
  const s = text.slice(start, m.index + m[0].length + 40).trim();
  return (start > 0 ? "…" : "") + s.slice(0, 110) + (s.length > 110 ? "…" : "");
};

/** Conversion features shown on the page, each with the text that gave it away where there is some. */
export function conversionFeatures(html: string, text: string, sections: PageSection[]): ConversionFeature[] {
  const out: ConversionFeature[] = [];
  for (const f of FEATURES) {
    const inText = f.text ? snippet(text, f.text) : undefined;
    const inHtml = !inText && f.html ? f.html.test(html) : false;
    const bySection =
      (f.key === "comparison" && sections.some((s) => s.label.startsWith("Comparison"))) ||
      (f.key === "faq" && sections.some((s) => s.label.startsWith("FAQ"))) ||
      (f.key === "sticky_atc" && sections.some((s) => s.label.startsWith("Sticky")));
    if (inText || inHtml || bySection) out.push({ key: f.key, label: f.label, ...(inText ? { evidence: inText } : {}) });
  }
  const checks = text.match(/[✓✔✅]/g)?.length ?? 0;
  if (checks >= 3) out.push({ key: "check_bullets", label: "✓ benefit bullets" });
  return out;
}

// ---------------------------------------------------------------- teardown

/**
 * Tears down one product page: its HTML and, when we could fetch them, /products/<handle>.js and
 * the Vitals offers JSON (vitalsOffersUrl).
 */
export function teardownProductPage(html: string, productPath: string, productJs?: unknown, currency?: string, vitalsOffers?: unknown): Teardown {
  const js = productJs && typeof productJs === "object" ? (productJs as Record<string, unknown>) : undefined;
  const price = productPrice(js, currency);
  const productId = num(js?.id);
  const sections = sectionOrder(html);
  const text = visibleText(html);
  const bundle =
    kachingBundle(html, price?.price) ?? koalaBundle(html) ?? vitalsBundle(vitalsOffers, price?.price) ?? debutifyBundle(html, js, price?.price);
  const reviews = reviewSummary(html, productId);
  const title = clean(js?.title) ?? clean(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]);
  return {
    productPath,
    ...(title ? { productTitle: title } : {}),
    ...(bundle ? { bundle } : {}),
    ...(reviews ? { reviews } : {}),
    ...(price ? { price } : {}),
    features: conversionFeatures(html, text, sections),
    sections,
  };
}

/** Where to fetch the product's JSON: /products/<handle>.js under the same locale prefix as the page. */
export function productJsPath(productPath: string): string | undefined {
  const m = productPath.match(/^((?:\/[a-z]{2}(?:-[a-z]{2})?)?)(?:\/collections\/[^/]+)?\/products\/([^/?#]+)/i);
  return m ? `${m[1]}/products/${m[2]}.js` : undefined;
}
