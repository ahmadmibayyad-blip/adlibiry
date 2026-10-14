// Mirror a page, whole store: the home page's layout and the store's look, read from its home page HTML.
// The home page's sections (Shopify's shopify-section-template--<id>__<name> ids, in page order) become
// our theme's home sections in the same order; its colors (theme CSS variables and backgrounds) and fonts
// become our theme's settings. Like lib/pageMirror.ts: structure and style only, never their text, photos,
// logo, customer photos or claims. storeKit.ts themeOverrides reads the plan. Pure.

import { sectionOrder } from "./storeTeardown";

/** Our theme's home sections (shopify-theme/sections). */
export type HomeSection = "hero" | "marquee" | "trust" | "product" | "benefits" | "steps" | "timeline" | "story" | "reviews" | "guarantee" | "faq" | "newsletter";

export type SiteLook = {
  colors?: { bg: string; surface: string; text: string; accent: string; accentText: string };
  /** Google Fonts families, with the weights they have. */
  fonts?: { head: string; body: string; headWeight?: number; bodyWeights?: string };
  uppercase?: boolean;
};

export type HomePlan = { sections: HomeSection[]; copied: string[]; skipped: string[] };

export const HOME_NAMES: Record<HomeSection, string> = {
  hero: "Hero",
  marquee: "Scrolling text",
  trust: "Trust icons",
  product: "Product with buy button",
  benefits: "Benefits",
  steps: "How it works",
  timeline: "What to expect",
  story: "Photo + text",
  reviews: "Reviews",
  guarantee: "Money-back guarantee",
  faq: "FAQ",
  newsletter: "Newsletter",
};

/** Our own home page order, for a home page we can't read. */
export const DEFAULT_HOME: HomeSection[] = ["hero", "trust", "product", "benefits", "steps", "story", "reviews", "faq", "newsletter"];

type Rule = [RegExp, HomeSection | "skip-layout" | "skip-video" | "skip-logos" | "skip-collection" | "skip-compare" | "skip-blog"];

// Section names, after the id suffix is removed. First match wins.
const RULES: Rule[] = [
  [/header|footer|announcement|popup|pop[-_]up|cart[-_]drawer|^apps?$|age[-_]verif|cookie/, "skip-layout"],
  [/marquee|ticker|scrolling|running[-_]?text|promo[-_]?bar|text[-_]?slider/, "marquee"],
  [/expect|timeline|journey|week|routine[-_]?result|transformation/, "timeline"],
  [/money[-_]?back|guarantee|garanti/, "guarantee"],
  [/faq|accordion|collapsible|questions/, "faq"],
  [/review|testimonial|loox|judge|jdgm|okendo|stamped|yotpo|trustpilot|quote/, "reviews"],
  [/video|ugc|tiktok|shoppable|reel/, "skip-video"],
  [/logo|press|as[-_]?seen|featured[-_]?in/, "skip-logos"],
  [/compar|(^|_)vs(_|$)|versus/, "skip-compare"],
  [/blog|article/, "skip-blog"],
  [/how[-_]?it[-_]?works|how[-_]?to|steps?($|[-_])|instructions/, "steps"],
  [/newsletter|email|signup|sign[-_]up|subscribe|klaviyo/, "newsletter"],
  [/trust|badge|usp[-_]?bar|icons[-_]?bar/, "trust"],
  [/featured[-_]?product|main[-_]?product|product[-_]?(form|hero|section)|buy[-_]?box/, "product"],
  [/collection|product[-_]?(grid|list|slider)|bestseller|best[-_]seller|shop[-_]?all/, "skip-collection"],
  [/hero|banner|slideshow|slider/, "hero"],
  [/image[-_]?with[-_]?text|image[-_]?text|media[-_]?text|about|story|mission|founder/, "story"],
  [/multi[-_]?column|icon|feature|benefit|why|ingredient|usp/, "benefits"],
];

const SKIP_NOTES: Record<string, string> = {
  "skip-video": "Their video wall: their customers' videos can't be reused. Add your own videos in Shopify's theme editor once you have them.",
  "skip-logos": "Their “as seen in” logos: not copied, press mentions have to be your own.",
  "skip-collection": "Their product grid: your store sells one product, so its buy section stands in for it.",
  "skip-compare": "Their comparison table: it's on your product page instead.",
  "skip-blog": "Their blog posts: not copied.",
};

const baseName = (id: string) => id.toLowerCase().replace(/_[A-Za-z0-9]{6}$/, "");

/** The home page's sections as ours, in their order (each once); unknown content sections fill benefits, then story, then steps. */
export function homePlan(html: string): HomePlan {
  const seen = new Set<string>();
  const sections: HomeSection[] = [];
  const skipped = new Set<string>();
  let unknown = 0;
  for (const s of sectionOrder(html)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const name = baseName(s.id);
    let kind = RULES.find(([re]) => re.test(name))?.[1];
    // A second banner further down is a photo-and-text row, not another hero.
    if (kind === "hero" && sections.includes("hero")) kind = "story";
    if (!kind) {
      if (/^\d{10}[0-9a-f]{6,10}$/.test(name)) continue;
      unknown++;
      kind = (["benefits", "story", "steps"] as const).find((k) => !sections.includes(k));
      if (!kind) continue;
    }
    if (kind.startsWith("skip-")) {
      if (SKIP_NOTES[kind]) skipped.add(SKIP_NOTES[kind]);
      continue;
    }
    const k = kind as HomeSection;
    if (!sections.includes(k)) sections.push(k);
  }
  if (sections.length < 3) {
    return { sections: DEFAULT_HOME, copied: [], skipped: ["We couldn't read their home page's sections (a page builder or an app draws it), so the home page follows our own order."] };
  }
  // A store needs a way in: the hero goes first, and reviews are kept even when their widget loads in the browser.
  const hero = sections.indexOf("hero");
  if (hero > 0) sections.splice(hero, 1);
  if (hero !== 0) sections.unshift("hero");
  if (!sections.includes("reviews")) sections.splice(Math.min(sections.length, 3), 0, "reviews");
  const copied = [`Home page: ${sections.map((s) => HOME_NAMES[s]).join(" → ")}`];
  if (unknown) copied.push(`${unknown} of their own section${unknown === 1 ? "" : "s"} became the closest of ours.`);
  if (sections.includes("timeline")) skipped.add("“What to expect” stages are written for your product, with a note that results vary: promising results you can't prove breaks EU consumer law.");
  if (/\b\d[\d.,]*\+?\s*(?:happy|satisfied|successful|customers|reviews|transformations)\b/i.test(html)) {
    skipped.add("Their customer and review counts (like “500,000+”): not copied. Only show numbers that are true for your store.");
  }
  return { sections, copied, skipped: [...skipped] };
}

// ---------------------------------------------------------------- look

type Rgb = [number, number, number];

function parseColor(v: string): Rgb | null {
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/) ?? s.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number) as Rgb;
    return rgb.every((n) => n <= 255) ? rgb : null;
  }
  return null;
}

const hex = (c: Rgb) => "#" + c.map((n) => n.toString(16).padStart(2, "0")).join("");

function hsl([r, g, b]: Rgb): { s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((n) => {
    const x = n / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((n, i) => Math.round(n * (1 - t) + b[i] * t)) as Rgb;

/** Counts of each color, by what the declaration names: buttons and accents, backgrounds, text. */
function colorVotes(html: string) {
  const accent = new Map<string, number>();
  const bg = new Map<string, number>();
  const text = new Map<string, number>();
  const add = (m: Map<string, number>, c: Rgb, n = 1) => m.set(hex(c), (m.get(hex(c)) ?? 0) + n);
  const re = /(--[\w-]+|background(?:-color)?|(?<![\w-])color)\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?=\s*[;}]))/g;
  for (const m of html.slice(0, 1_500_000).matchAll(re)) {
    const name = m[1].toLowerCase();
    const c = parseColor(m[2]);
    if (!c || /rgba\([^)]*,\s*0(?:\.0*)?\s*\)/.test(m[2])) continue;
    if (/shadow|border|overlay|error|success|warning|sale|badge|star|rating|review|placeholder|disabled|shimmer|lighten|darken|hover/.test(name)) continue;
    if (/button|btn|accent|primary|brand|cta/.test(name) && !/text|foreground|label|border/.test(name)) add(accent, c, 3);
    if (/background|bg/.test(name) || name === "background-color" || name === "background") add(bg, c);
    else if (/text|foreground|heading|body|^color$/.test(name)) add(text, c);
  }
  return { accent, bg, text };
}

const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => parseColor(h) as Rgb);
const saturated = (c: Rgb) => {
  const { s, l } = hsl(c);
  return s > 0.25 && l > 0.12 && l < 0.8;
};

/** The store's colors and fonts. Missing parts (an unreadable theme, fonts not on Google Fonts) are left out. */
export function siteLook(html: string): SiteLook {
  const look: SiteLook = {};
  const votes = colorVotes(html);
  const accent = ranked(votes.accent).find(saturated) ?? ranked(votes.bg).find(saturated);
  if (accent) {
    const bgs = ranked(votes.bg);
    const light = bgs.filter((c) => hsl(c).l > 0.9);
    const white = light.find((c) => c.every((n) => n >= 250));
    const bg = white ?? light[0] ?? ([255, 255, 255] as Rgb);
    const text = ranked(votes.text).find((c) => hsl(c).l < 0.3 && contrast(c, bg) >= 7) ?? ([17, 17, 17] as Rgb);
    const surface = light.find((c) => hex(c) !== hex(bg) && contrast(c, bg) > 1.03) ?? mix(bg, accent, 0.08);
    const accentText: Rgb = contrast([255, 255, 255], accent) >= contrast(text, accent) ? [255, 255, 255] : text;
    look.colors = { bg: hex(bg), surface: hex(surface), text: hex(text), accent: hex(accent), accentText: hex(accentText) };
  }
  const fonts = siteFonts(html);
  if (fonts) look.fonts = fonts;
  const headings = html.match(/<h[12][^>]*class="[^"]*uppercase[^"]*"/gi)?.length ?? 0;
  if (headings >= 3 || /--(?:font[-_]heading[-_])?text[-_]transform(?:[-_]heading)?\s*:\s*uppercase/i.test(html)) look.uppercase = true;
  return look;
}

// Google Fonts families stores commonly use; a theme font outside this list is left to the style's pair.
export const GOOGLE_FONTS = [
  "Poppins", "Montserrat", "Inter", "Roboto", "Open Sans", "Lato", "Nunito", "Nunito Sans", "Raleway", "Work Sans", "DM Sans", "Manrope",
  "Plus Jakarta Sans", "Outfit", "Urbanist", "Figtree", "Epilogue", "Archivo", "Archivo Black", "Barlow", "Barlow Condensed", "Oswald",
  "Anton", "Bebas Neue", "Rubik", "Karla", "Mulish", "Jost", "Josefin Sans", "Quicksand", "Lexend", "Sora", "Space Grotesk", "Syne",
  "Playfair Display", "Cormorant Garamond", "Cormorant", "Lora", "Merriweather", "Libre Baskerville", "EB Garamond", "Fraunces", "DM Serif Display",
  "Prata", "Bodoni Moda", "Abril Fatface", "Fredoka", "Baloo 2", "Kanit", "Titillium Web", "Assistant", "Heebo", "Source Sans 3", "PT Sans",
  "Noto Sans", "Ubuntu", "Cabin", "Hind", "Red Hat Display", "Albert Sans", "Instrument Sans", "Onest", "Inter Tight", "Libre Franklin",
  "Crimson Text", "Cinzel", "Marcellus", "Tenor Sans", "Italiana", "Zilla Slab", "Arimo", "Mukta", "Questrial", "League Spartan", "Chivo",
];
// Fonts with only a regular weight: Google Fonts refuses a request for bold ones.
const SINGLE_WEIGHT = new Set(["Archivo Black", "Anton", "Bebas Neue", "DM Serif Display", "Prata", "Abril Fatface", "Questrial", "Marcellus", "Tenor Sans", "Italiana"]);
const FONT_KEY = new Map(GOOGLE_FONTS.map((f) => [f.toLowerCase().replace(/\s+/g, " "), f]));

/** Heading and body fonts from font-family declarations (and Shopify's --font-heading-family / --font-body-family). */
export function siteFonts(html: string): SiteLook["fonts"] {
  const all = new Map<string, number>();
  const head = new Map<string, number>();
  const body = new Map<string, number>();
  const re = /(--[\w-]*font[\w-]*|font-family)\s*:\s*["']?([A-Za-z][A-Za-z0-9 ]{1,40}?)["']?\s*[,;}]/gi;
  for (const m of html.slice(0, 1_500_000).matchAll(re)) {
    const font = FONT_KEY.get(m[2].trim().toLowerCase().replace(/\s+/g, " "));
    if (!font) continue;
    const name = m[1].toLowerCase();
    all.set(font, (all.get(font) ?? 0) + 1);
    if (/head|title|display/.test(name)) head.set(font, (head.get(font) ?? 0) + 5);
    if (/body|base|text/.test(name)) body.set(font, (body.get(font) ?? 0) + 5);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const b = top(body) ?? top(all);
  if (!b) return undefined;
  const h = top(head) ?? b;
  return { head: h, body: b, ...(SINGLE_WEIGHT.has(h) ? { headWeight: 400 } : {}), ...(SINGLE_WEIGHT.has(b) ? { bodyWeights: "400" } : {}) };
}

/** What the look copied, for the launch's "what Mirror took" list. */
export function lookNote(look: SiteLook): string[] {
  const out: string[] = [];
  if (look.colors) out.push(`Colors: ${look.colors.accent} buttons and accents, ${look.colors.surface} soft backgrounds, ${look.colors.text} text`);
  if (look.fonts) out.push(`Fonts: ${look.fonts.head === look.fonts.body ? look.fonts.head : `${look.fonts.head} headings, ${look.fonts.body} text`}${look.uppercase ? ", uppercase headings" : ""}`);
  return out;
}
