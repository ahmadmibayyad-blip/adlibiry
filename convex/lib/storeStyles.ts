// The looks a launched store can have (Launch → Full store). Each one is a set
// of Theme settings for our storefront theme (shopify-theme/, settings ids in
// config/settings_schema.json) plus how the home page is laid out. The Launch
// dialog draws its preview cards from the same values.

export const STORE_STYLE_IDS = ["fresh", "glow", "clinic", "bold", "sport", "luxe", "mono", "playful", "soft", "nordic", "cozy", "tech"] as const;
/** The theme's built-in font pairs (settings_schema.json font_pair); other looks set Google fonts by name (customFonts). */
export type FontPair = "fresh" | "bold" | "luxe" | "playful" | "nordic" | "tech";
export type StoreStyleId = (typeof STORE_STYLE_IDS)[number];

export type StoreStyle = {
  id: StoreStyleId;
  name: string;
  description: string;
  /** Google Fonts families, for the dashboard preview (the theme loads its own). */
  fonts: { head: string; body: string; headWeight: number };
  settings: {
    color_bg: string;
    color_surface: string;
    color_text: string;
    color_accent: string;
    color_accent_text: string;
    color_sale: string;
    font_pair: FontPair;
    heading_uppercase: boolean;
    radius: number;
    button_pill: boolean;
  };
  /** Home page section backgrounds: hero, trust bar, benefits, steps, story, FAQ, newsletter. */
  schemes: { hero: Scheme; trust: Scheme; benefits: Scheme; steps: Scheme; story: Scheme; faq: Scheme; newsletter: Scheme };
  heroLayout: "split" | "center";
  /** Google fonts by name, over font_pair (theme settings custom_head_font / custom_body_font); weights that exist for them. */
  customFonts?: { head: string; body: string; headWeight: number; bodyWeights: string };
  benefitsLayout: "cards" | "row";
};

type Scheme = "base" | "surface" | "accent" | "inverse";

export const STORE_STYLES: Record<StoreStyleId, StoreStyle> = {
  fresh: {
    id: "fresh",
    name: "Fresh",
    description: "Clean and bright. Fits home, kitchen, health and everyday products.",
    fonts: { head: "Plus Jakarta Sans", body: "Plus Jakarta Sans", headWeight: 700 },
    settings: {
      color_bg: "#ffffff",
      color_surface: "#eef6f3",
      color_text: "#11211b",
      color_accent: "#0f766e",
      color_accent_text: "#ffffff",
      color_sale: "#c2410c",
      font_pair: "fresh",
      heading_uppercase: false,
      radius: 14,
      button_pill: true,
    },
    schemes: { hero: "surface", trust: "inverse", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "cards",
  },
  bold: {
    id: "bold",
    name: "Bold",
    description: "Loud, high-contrast and direct. Fits gadgets, fitness and viral products.",
    fonts: { head: "Archivo Black", body: "Archivo", headWeight: 400 },
    settings: {
      color_bg: "#fffdf5",
      color_surface: "#f4f0e1",
      color_text: "#0b0b0b",
      color_accent: "#ffd400",
      color_accent_text: "#0b0b0b",
      color_sale: "#e11d48",
      font_pair: "bold",
      heading_uppercase: true,
      radius: 4,
      button_pill: false,
    },
    schemes: { hero: "accent", trust: "inverse", benefits: "base", steps: "inverse", story: "surface", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "cards",
  },
  luxe: {
    id: "luxe",
    name: "Luxe",
    description: "Dark, elegant and calm. Fits beauty, jewelry and premium gifts.",
    fonts: { head: "Cormorant Garamond", body: "Inter", headWeight: 600 },
    settings: {
      color_bg: "#100f0d",
      color_surface: "#1c1a17",
      color_text: "#f4efe7",
      color_accent: "#c9a96b",
      color_accent_text: "#100f0d",
      color_sale: "#e7a17a",
      font_pair: "luxe",
      heading_uppercase: false,
      radius: 2,
      button_pill: false,
    },
    schemes: { hero: "base", trust: "surface", benefits: "base", steps: "surface", story: "base", faq: "surface", newsletter: "surface" },
    heroLayout: "center",
    benefitsLayout: "row",
  },
  playful: {
    id: "playful",
    name: "Playful",
    description: "Soft colors and round shapes. Fits pets, kids, toys and hobbies.",
    fonts: { head: "Fredoka", body: "Nunito", headWeight: 600 },
    settings: {
      color_bg: "#fff8f3",
      color_surface: "#ffe8ef",
      color_text: "#2b2140",
      color_accent: "#d12a60",
      color_accent_text: "#ffffff",
      color_sale: "#7c3aed",
      font_pair: "playful",
      heading_uppercase: false,
      radius: 24,
      button_pill: true,
    },
    schemes: { hero: "surface", trust: "accent", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "cards",
  },
  nordic: {
    id: "nordic",
    name: "Nordic",
    description: "Warm, natural and minimal. Fits home decor, wellness and eco products.",
    fonts: { head: "Fraunces", body: "Inter", headWeight: 500 },
    settings: {
      color_bg: "#f7f2eb",
      color_surface: "#ece3d6",
      color_text: "#29251f",
      color_accent: "#3d5a45",
      color_accent_text: "#ffffff",
      color_sale: "#a4472b",
      font_pair: "nordic",
      heading_uppercase: false,
      radius: 8,
      button_pill: false,
    },
    schemes: { hero: "surface", trust: "base", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "row",
  },
  tech: {
    id: "tech",
    name: "Tech",
    description: "Dark and sharp with electric blue. Fits electronics, car and smart-home gear.",
    fonts: { head: "Space Grotesk", body: "Inter", headWeight: 600 },
    settings: {
      color_bg: "#0a0f1f",
      color_surface: "#121a33",
      color_text: "#e7ecff",
      color_accent: "#3b63e6",
      color_accent_text: "#ffffff",
      color_sale: "#22d3ee",
      font_pair: "tech",
      heading_uppercase: false,
      radius: 12,
      button_pill: false,
    },
    schemes: { hero: "surface", trust: "base", benefits: "base", steps: "surface", story: "base", faq: "surface", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "row",
  },
  glow: {
    id: "glow",
    name: "Glow",
    description: "Fresh greens and clean type, like the skincare brands that sell on ads. Fits beauty, skincare and self-care.",
    fonts: { head: "Poppins", body: "Poppins", headWeight: 700 },
    customFonts: { head: "Poppins", body: "Poppins", headWeight: 700, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#ffffff",
      color_surface: "#f2f8ec",
      color_text: "#122312",
      color_accent: "#2c5801",
      color_accent_text: "#ffffff",
      color_sale: "#c2410c",
      font_pair: "fresh",
      heading_uppercase: false,
      radius: 12,
      button_pill: true,
    },
    schemes: { hero: "surface", trust: "accent", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "cards",
  },
  clinic: {
    id: "clinic",
    name: "Clinic",
    description: "Crisp white and trustworthy blue. Fits health, posture, sleep and care products.",
    fonts: { head: "Manrope", body: "Manrope", headWeight: 800 },
    customFonts: { head: "Manrope", body: "Manrope", headWeight: 800, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#ffffff",
      color_surface: "#eef3fa",
      color_text: "#0f1b2d",
      color_accent: "#1f4fd1",
      color_accent_text: "#ffffff",
      color_sale: "#d92d20",
      font_pair: "fresh",
      heading_uppercase: false,
      radius: 10,
      button_pill: false,
    },
    schemes: { hero: "surface", trust: "inverse", benefits: "base", steps: "surface", story: "base", faq: "surface", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "row",
  },
  sport: {
    id: "sport",
    name: "Sport",
    description: "Black with neon lime and tall capitals. Fits fitness, outdoor and performance gear.",
    fonts: { head: "Anton", body: "Inter", headWeight: 400 },
    customFonts: { head: "Anton", body: "Inter", headWeight: 400, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#0d0d0d",
      color_surface: "#1b1b1b",
      color_text: "#f4f4f4",
      color_accent: "#c6ff3d",
      color_accent_text: "#0d0d0d",
      color_sale: "#ff5a4e",
      font_pair: "bold",
      heading_uppercase: true,
      radius: 4,
      button_pill: false,
    },
    schemes: { hero: "base", trust: "accent", benefits: "base", steps: "surface", story: "base", faq: "surface", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "cards",
  },
  mono: {
    id: "mono",
    name: "Mono",
    description: "Black and white, square and quiet. Fits fashion, accessories and design objects.",
    fonts: { head: "Inter Tight", body: "Inter", headWeight: 600 },
    customFonts: { head: "Inter Tight", body: "Inter", headWeight: 600, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#ffffff",
      color_surface: "#f3f3f1",
      color_text: "#111111",
      color_accent: "#111111",
      color_accent_text: "#ffffff",
      color_sale: "#b42318",
      font_pair: "tech",
      heading_uppercase: true,
      radius: 0,
      button_pill: false,
    },
    schemes: { hero: "base", trust: "inverse", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "inverse" },
    heroLayout: "center",
    benefitsLayout: "row",
  },
  soft: {
    id: "soft",
    name: "Soft",
    description: "Lavender pastels and rounded letters. Fits baby, beauty tools and gifts.",
    fonts: { head: "Quicksand", body: "Quicksand", headWeight: 700 },
    customFonts: { head: "Quicksand", body: "Quicksand", headWeight: 700, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#fdfbff",
      color_surface: "#efe9fb",
      color_text: "#251c3d",
      color_accent: "#6a48d7",
      color_accent_text: "#ffffff",
      color_sale: "#d9467a",
      font_pair: "playful",
      heading_uppercase: false,
      radius: 22,
      button_pill: true,
    },
    schemes: { hero: "surface", trust: "base", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "center",
    benefitsLayout: "cards",
  },
  cozy: {
    id: "cozy",
    name: "Cozy",
    description: "Warm cream, terracotta and a classic serif. Fits home, kitchen, candles and comfort.",
    fonts: { head: "DM Serif Display", body: "DM Sans", headWeight: 400 },
    customFonts: { head: "DM Serif Display", body: "DM Sans", headWeight: 400, bodyWeights: "400;500;600;700" },
    settings: {
      color_bg: "#fbf6f0",
      color_surface: "#f2e5d7",
      color_text: "#2a1d14",
      color_accent: "#b4532a",
      color_accent_text: "#ffffff",
      color_sale: "#8a3a1c",
      font_pair: "nordic",
      heading_uppercase: false,
      radius: 16,
      button_pill: true,
    },
    schemes: { hero: "surface", trust: "base", benefits: "base", steps: "surface", story: "base", faq: "base", newsletter: "accent" },
    heroLayout: "split",
    benefitsLayout: "row",
  },
};

/**
 * The theme a Full store is built on: our AdSpy Storefront theme (shopify-theme/), or Shopify's
 * free Dawn (shopify-theme-dawn/, lib/dawnTheme.ts) with the same copy, colors and fonts.
 */
export const BASE_THEMES = ["adspy", "dawn"] as const;
export type BaseTheme = (typeof BASE_THEMES)[number];
export const BASE_THEME_NAMES: Record<BaseTheme, string> = { adspy: "AdSpy Storefront", dawn: "Dawn" };
export const isBaseTheme = (v: unknown): v is BaseTheme => typeof v === "string" && (BASE_THEMES as readonly string[]).includes(v);

export const isStoreStyle = (s: unknown): s is StoreStyleId => typeof s === "string" && (STORE_STYLE_IDS as readonly string[]).includes(s);

/** One Google Fonts stylesheet with every style's fonts, for the dashboard previews. */
export const STORE_STYLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;600&family=Cormorant+Garamond:wght@600" +
  "&family=Fraunces:wght@500&family=Fredoka:wght@600&family=Inter:wght@400;600&family=Nunito:wght@400;700" +
  "&family=Plus+Jakarta+Sans:wght@400;700&family=Space+Grotesk:wght@600&family=Poppins:wght@400;700&family=Manrope:wght@400;800" +
  "&family=Anton&family=Inter+Tight:wght@600&family=Quicksand:wght@400;700&family=DM+Serif+Display&family=DM+Sans:wght@400;600&display=swap";
