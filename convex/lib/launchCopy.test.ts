import { describe, expect, it } from "vitest";
import { charmFor, cleanCopy, handleFor, launchFacts, launchProductInput, pageHtml, proofLine, scrubClaims, suggestPrice, type LaunchCopy } from "./launchCopy";
import { authorizeUrl, decryptToken, encryptToken, verifyQueryHmac, verifyWebhookHmac } from "./shopifyOAuth";

const copy: LaunchCopy = {
  title: "Instant Posture Corrector",
  subtitle: "Sit straighter in minutes",
  benefits: ["Pulls shoulders back gently", "Wear it under clothes", "Adjustable straps"],
  hook: "Desk days leave your back tired?",
  howItWorks: ["Slip it on", "Tighten the straps", "Wear 20 minutes a day"],
  whatsIncluded: ["1 posture corrector"],
  faq: [{ q: "Which size?", a: "One size fits chest 70–120 cm." }],
  shippingReturns: "Ships from our partner warehouse.",
  seo: { title: "Posture Corrector", description: "Adjustable posture corrector you wear under clothes." },
  adKit: [{ angle: "Desk workers", hook: "Your back after 8 hours at a desk…", primaryText: "Wear it under your shirt.", headline: "Sit straighter" }],
};

describe("Launch price", () => {
  it("prices from the real supplier cost at about 2.8× and shows the margin", () => {
    expect(suggestPrice({ cost: 10 })).toEqual({ price: 27.99, cost: 10, marginPercent: 64 });
    expect(suggestPrice({ cost: 4.2 })).toMatchObject({ price: 11.99 });
    expect(suggestPrice({ cost: 4.2 }).price! / 4.2).toBeGreaterThanOrEqual(2.5);
    expect(suggestPrice({ price: 39.5 })).toEqual({ price: 39.5 });
    expect(suggestPrice({})).toEqual({});
  });

  it("prices in the store's currency, with that currency's price endings", () => {
    // $4.20 cost in a Danish store at 6.4 DKK/USD: cost 26.88 DKK, about 2.8× → 79 kr, not "13.48 DKK".
    expect(suggestPrice({ cost: 4.2 }, { currency: "DKK", rate: 6.4 })).toEqual({ price: 79, cost: 26.88, marginPercent: 66 });
    expect(suggestPrice({ cost: 10 }, { currency: "EUR", rate: 0.86 })).toMatchObject({ price: 23.99, cost: 8.6 });
    expect(suggestPrice({ price: 20 }, { currency: "SEK", rate: 9.5 })).toEqual({ price: 199 });
    expect(charmFor(87.3, "DKK")).toBe(89);
    expect(charmFor(143, "DKK")).toBe(149);
    expect(charmFor(150, "DKK")).toBe(159);
    expect(charmFor(27.4, "EUR")).toBe(26.99);
  });
});

describe("Launch copy rules", () => {
  it("drops claims we can't back up", () => {
    const r = scrubClaims("Comfortable all day. Clinically proven to fix posture. Cures back pain fast! Adjustable straps. Join 50,000 happy customers.");
    expect(r.text).toBe("Comfortable all day. Adjustable straps.");
    expect(r.dropped).toBe(3);
  });

  it("caps lengths and counts and keeps only complete FAQ and ad kit items", () => {
    const { copy: c } = cleanCopy({
      ...copy,
      title: "x".repeat(200),
      benefits: ["a", "b", "c", "d", "e", "f", "g"],
      faq: [{ q: "Q?", a: "" }, { q: "Size?", a: "One size." }],
      adKit: [{ angle: "A", hook: "", primaryText: "text", headline: "h" }, ...copy.adKit, ...copy.adKit, ...copy.adKit],
    });
    expect(c.title).toHaveLength(70);
    expect(c.benefits).toHaveLength(5);
    expect(c.faq).toEqual([{ q: "Size?", a: "One size." }]);
    expect(c.adKit).toHaveLength(3);
  });

  it("gives the AI only real facts, including the ads already selling it", () => {
    const facts = launchFacts(
      { title: "Posture Corrector", description: "", category: "Health & Wellness", imageUrl: "", supplierMatches: [{ title: "x", price: 4, orders: 1400, rating: 96 }] },
      [{ headline: "Fix your posture", bodyText: "Wear it daily", platform: "Facebook", spokenHook: "Your back hurts because…" }],
      { language: "Danish", tone: "friendly", price: 27.99 },
    );
    expect(facts).toContain("1,400+ sold");
    expect(facts).toContain("[Facebook] Your back hurts because…");
    expect(facts).toContain("Write in: Danish. Tone: friendly.");
  });
});

describe("Launch page and Shopify product", () => {
  it("renders an escaped page that works in any theme's description", () => {
    const html = pageHtml({ ...copy, hook: "<script>alert(1)</script>" }, "1400+ ordered");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h3>FAQ</h3><details>");
    expect(html).toContain("<em>1400+ ordered</em>");
  });

  it("only shows a real supplier order count", () => {
    expect(proofLine({ title: "", description: "", category: "", imageUrl: "", supplierMatches: [{ title: "", price: 1, orders: 1437 }] })).toBe("1400+ ordered from our supplier in the last 30 days");
    expect(proofLine({ title: "", description: "", category: "", imageUrl: "", supplierMatches: [{ title: "", price: 1, orders: 40 }] })).toBeUndefined();
  });

  it("builds the productSet input: price, cost, images, SEO and the metafield", () => {
    const input = launchProductInput(
      { title: "Old title", description: "", category: "Health & Wellness", imageUrl: "https://cdn.x/1.jpg", images: ["https://cdn.x/1.jpg", "https://cdn.x/2.jpg", "http://insecure/3.jpg"] },
      copy,
      { price: 27.99, cost: 10, status: "DRAFT" },
    );
    expect(input).toMatchObject({ title: "Instant Posture Corrector", handle: "instant-posture-corrector", status: "DRAFT", seo: { title: "Posture Corrector" } });
    expect(input.variants[0]).toMatchObject({ price: "27.99", inventoryItem: { cost: "10.00", tracked: false } });
    expect(input.files.map((f) => f.originalSource)).toEqual(["https://cdn.x/1.jpg", "https://cdn.x/2.jpg"]);
    expect(JSON.parse(input.metafields[0].value).benefits).toHaveLength(3);
  });
});

describe("handleFor", () => {
  it("spells out letters that have no accent-free form", () => {
    expect(handleFor("Pibende hundelegetøj i latex – sæt med 4")).toBe("pibende-hundelegetoej-i-latex-saet-med-4");
    expect(handleFor("Crème brûlée Straße")).toBe("creme-brulee-strasse");
    expect(handleFor("!!!")).toBe("product");
  });
});

describe("Shopify app security", () => {
  const secret = "hush";
  it("verifies Shopify's signed callback and rejects tampering", async () => {
    const params = new URLSearchParams({ code: "abc", shop: "my-store.myshopify.com", state: "s1", timestamp: "1700000000" });
    const msg = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))), (b) => b.toString(16).padStart(2, "0")).join("");
    params.set("hmac", sig);
    expect(await verifyQueryHmac(params, secret)).toBe(true);
    params.set("shop", "evil.myshopify.com");
    expect(await verifyQueryHmac(params, secret)).toBe(false);
  });

  it("verifies webhook bodies", async () => {
    const body = '{"id":1}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
    expect(await verifyWebhookHmac(body, sig, secret)).toBe(true);
    expect(await verifyWebhookHmac('{"id":2}', sig, secret)).toBe(false);
    expect(await verifyWebhookHmac(body, null, secret)).toBe(false);
  });

  it("encrypts tokens at rest and still reads older plain ones", async () => {
    const keyB64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const stored = await encryptToken("shpat_secret", keyB64);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("shpat_secret");
    expect(await decryptToken(stored, keyB64)).toBe("shpat_secret");
    expect(await decryptToken("shpat_plain", undefined)).toBe("shpat_plain");
  });

  it("asks only for the scopes Launch needs", () => {
    const url = new URL(authorizeUrl("my-store.myshopify.com", "client123", "https://x.convex.site/shopify/callback", "st"));
    expect(url.origin).toBe("https://my-store.myshopify.com");
    expect(url.searchParams.get("scope")).toBe(
      "write_products,read_products,write_publications,read_publications," +
        "write_themes,read_themes,write_online_store_pages,read_online_store_pages,write_online_store_navigation,read_online_store_navigation",
    );
    expect(url.searchParams.get("state")).toBe("st");
  });
});
