// Launch (convex/launch.ts): the facts we give the AI, the rules its copy
// must follow, the product page it becomes, and the Shopify product we create.
// Pure and unit-tested; no network.

export type LaunchCopy = {
  title: string;
  subtitle: string;
  benefits: string[];
  hook: string;
  howItWorks: string[];
  whatsIncluded: string[];
  faq: { q: string; a: string }[];
  shippingReturns: string;
  seo: { title: string; description: string };
  adKit: { angle: string; hook: string; primaryText: string; headline: string }[];
};

export type LaunchProduct = {
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  images?: string[];
  price?: number;
  cost?: number;
  supplierMatches?: { title: string; price: number; orders?: number; rating?: number }[];
};

export type LaunchAd = { headline: string; bodyText: string; spokenHook?: string; platform: string };

// ── price ────────────────────────────────────────────────────────────────────

/** Ends in .99, rounded to the nearest whole first: 27.4 → 26.99, 27.6 → 27.99. */
const charmPrice = (n: number) => Math.max(0.99, Math.round(n) - 0.01);

/**
 * Retail price from the real supplier cost (best AliExpress match + shipping is
 * already in `cost`): about 2.8×, never below 2.5×. Without a cost, the
 * product's market price. Returns the margin so the user sees it.
 */
export function suggestPrice(p: Pick<LaunchProduct, "price" | "cost">): { price?: number; cost?: number; marginPercent?: number } {
  if (p.cost && p.cost > 0) {
    let price = charmPrice(p.cost * 2.8);
    if (price < p.cost * 2.5) price = charmPrice(p.cost * 2.5 + 1);
    return { price, cost: p.cost, marginPercent: Math.round(((price - p.cost) / price) * 100) };
  }
  return p.price && p.price > 0 ? { price: Math.round(p.price * 100) / 100 } : {};
}

// ── facts for the AI ───────────────────────────────────────────────────────

const clip = (s: string | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

/** Only true things: the product, its real supplier signals and the ads already selling it. */
export function launchFacts(p: LaunchProduct, ads: LaunchAd[], opts: { language: string; tone: string; price?: number }): string {
  const best = p.supplierMatches?.[0];
  const lines = [
    `Product: ${p.title}`,
    `Niche: ${p.category}`,
    opts.price ? `Selling price: ${opts.price}` : "",
    p.description ? `Known description: ${clip(p.description, 800)}` : "",
    best?.orders ? `Supplier proof (real, may be quoted as "${best.orders.toLocaleString("en-US")}+ sold"): ${best.orders} orders in 30 days` : "",
    best?.rating ? `Supplier rating: ${best.rating}% positive` : "",
    ads.length ? "Ads already selling it (learn the angles, don't copy them word for word):" : "",
    ...ads.slice(0, 3).map((a, i) => `${i + 1}. [${a.platform}] ${clip(a.spokenHook || a.headline, 160)} — ${clip(a.bodyText, 300)}`),
    `Write in: ${opts.language}. Tone: ${opts.tone}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const LAUNCH_SYSTEM =
  "You write Shopify product pages for dropshipping stores. Use only the facts given: never invent reviews, ratings, " +
  "sales numbers, awards, certifications, discounts, guarantees or medical/health effects. Benefits must follow from what " +
  "the product is. Short sentences, concrete, no hype words like 'revolutionary' or 'miracle'. The FAQ answers real " +
  "buyer questions (sizing, use, care, shipping) without promising delivery times you don't know. The ad kit gives three " +
  "different angles learned from the ads already selling it. Return the requested JSON only.";

// ── claim rules ─────────────────────────────────────────────────────────────

// Claims that get ad accounts banned and break consumer law when you can't prove them.
const BANNED = [
  /\b(cures?|cured|heals?|treats?|prevents?|reverses?)\b[^.!?]*\b(disease|illness|pain|arthritis|diabetes|cancer|anxiety|depression|scoliosis|infection|insomnia)/i,
  /\b(fda|ce)[ -]?(approved|certified|cleared)\b/i,
  /\bclinically (proven|tested)\b/i,
  /\b(100%|guaranteed?)\s+(results?|effective|success|satisfaction)\b/i,
  /\bmoney[- ]back guarantee\b/i,
  /\b(#1|number one|best[- ]selling|world'?s best)\b/i,
  /\b(lose|losing)\s+\d+\s*(kg|lbs?|pounds)\b/i,
  /\b\d[\d,.]*\+?\s*(happy|satisfied)?\s*(customers|reviews|buyers)\b/i,
];

/** Drops sentences making claims we can't back up. Returns the cleaned text and how many were dropped. */
export function scrubClaims(text: string): { text: string; dropped: number } {
  let dropped = 0;
  const kept = (text.match(/[^.!?]+[.!?]*/g) ?? [text]).filter((sentence) => {
    const bad = BANNED.some((re) => re.test(sentence));
    if (bad) dropped++;
    return !bad;
  });
  return { text: kept.join("").replace(/\s{2,}/g, " ").trim(), dropped };
}

const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Enforces lengths and counts, and the claim rules, on whatever the AI returned. */
export function cleanCopy(raw: LaunchCopy): { copy: LaunchCopy; dropped: number } {
  let dropped = 0;
  const s = (v: unknown, n: number) => {
    const r = scrubClaims(cut(v, n * 2));
    dropped += r.dropped;
    return r.text.slice(0, n);
  };
  const list = (arr: unknown, max: number, n: number) => (Array.isArray(arr) ? arr : []).map((x) => s(x, n)).filter(Boolean).slice(0, max);
  const copy: LaunchCopy = {
    title: s(raw.title, 70),
    subtitle: s(raw.subtitle, 140),
    benefits: list(raw.benefits, 5, 140),
    hook: s(raw.hook, 400),
    howItWorks: list(raw.howItWorks, 4, 200),
    whatsIncluded: list(raw.whatsIncluded, 6, 120),
    faq: (Array.isArray(raw.faq) ? raw.faq : [])
      .map((f) => ({ q: s(f?.q, 140), a: s(f?.a, 400) }))
      .filter((f) => f.q && f.a)
      .slice(0, 6),
    shippingReturns: s(raw.shippingReturns, 400),
    seo: { title: s(raw.seo?.title, 70), description: s(raw.seo?.description, 160) },
    adKit: (Array.isArray(raw.adKit) ? raw.adKit : [])
      .map((a) => ({ angle: s(a?.angle, 60), hook: s(a?.hook, 160), primaryText: s(a?.primaryText, 600), headline: s(a?.headline, 60) }))
      .filter((a) => a.hook && a.primaryText)
      .slice(0, 3),
  };
  return { copy, dropped };
}

// ── the page (product description: works on every theme) ────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function pageHtml(c: LaunchCopy, proof?: string): string {
  const parts: string[] = [];
  if (c.hook) parts.push(`<p><strong>${esc(c.hook)}</strong></p>`);
  if (c.benefits.length) parts.push(`<ul>${c.benefits.map((b) => `<li>✓ ${esc(b)}</li>`).join("")}</ul>`);
  if (proof) parts.push(`<p><em>${esc(proof)}</em></p>`);
  if (c.howItWorks.length) parts.push(`<h3>How it works</h3><ol>${c.howItWorks.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`);
  if (c.whatsIncluded.length) parts.push(`<h3>What's included</h3><ul>${c.whatsIncluded.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  if (c.faq.length) {
    parts.push(`<h3>FAQ</h3>${c.faq.map((f) => `<details><summary><strong>${esc(f.q)}</strong></summary><p>${esc(f.a)}</p></details>`).join("")}`);
  }
  if (c.shippingReturns) parts.push(`<h3>Shipping &amp; returns</h3><p>${esc(c.shippingReturns)}</p>`);
  return parts.join("\n");
}

/** A real, checkable sales signal from the supplier, or nothing. */
export function proofLine(p: LaunchProduct): string | undefined {
  const orders = p.supplierMatches?.[0]?.orders;
  return orders && orders >= 100 ? `${Math.floor(orders / 100) * 100}+ ordered from our supplier in the last 30 days` : undefined;
}

export const handleFor = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";

/** Shopify productSet input: the page, price and cost, images, SEO, and the copy as a metafield for our theme block. */
export function launchProductInput(p: LaunchProduct, c: LaunchCopy, o: { price?: number; cost?: number; status: "DRAFT" | "ACTIVE" }) {
  const images = [...new Set([p.imageUrl, ...(p.images ?? [])].filter((u) => /^https:\/\//.test(u)))].slice(0, 10);
  const title = c.title || p.title.slice(0, 255);
  return {
    title,
    handle: handleFor(title),
    descriptionHtml: pageHtml(c, proofLine(p)),
    productType: p.category,
    tags: ["AdSpy Launch", p.category],
    status: o.status,
    seo: { title: c.seo.title || title, description: c.seo.description || c.subtitle },
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        ...(o.price ? { price: o.price.toFixed(2) } : {}),
        ...(o.cost ? { inventoryItem: { cost: o.cost.toFixed(2), tracked: false } } : {}),
      },
    ],
    files: images.map((u, i) => ({ originalSource: u, contentType: "IMAGE", alt: i === 0 ? title.slice(0, 200) : `${title.slice(0, 180)} ${i + 1}` })),
    metafields: [{ namespace: "adspy", key: "page", type: "json", value: JSON.stringify({ subtitle: c.subtitle, benefits: c.benefits, faq: c.faq, proof: proofLine(p) ?? null }) }],
  };
}
