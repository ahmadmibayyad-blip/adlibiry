// Store Teardown (Store Inspector, convex/storeInspector.ts): what a Shopify
// product page shows a shopper, read from its plain HTML and /products/<handle>.js:
// bundle / quantity-break tiers (Kaching Bundles' embedded settings JSON, Upsell
// Koala's server-rendered tiers), the review widget's rating and count, price vs
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

/** Tears down one product page: its HTML and, when we could fetch it, /products/<handle>.js. */
export function teardownProductPage(html: string, productPath: string, productJs?: unknown, currency?: string): Teardown {
  const js = productJs && typeof productJs === "object" ? (productJs as Record<string, unknown>) : undefined;
  const price = productPrice(js, currency);
  const productId = num(js?.id);
  const sections = sectionOrder(html);
  const text = visibleText(html);
  const bundle = kachingBundle(html, price?.price) ?? koalaBundle(html);
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
