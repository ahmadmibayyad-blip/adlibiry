// The looks a launched store can have (Launch → Full store). Each one is a set
// of Theme settings for our storefront theme (shopify-theme/, settings ids in
// config/settings_schema.json) plus how the home page is laid out. The Launch
// dialog draws its preview cards from the same values.

export const STORE_STYLE_IDS = ["fresh", "bold", "luxe", "playful", "nordic", "tech"] as const;
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
    font_pair: StoreStyleId;
    heading_uppercase: boolean;
    radius: number;
    button_pill: boolean;
  };
  /** Home page section backgrounds: hero, trust bar, benefits, steps, story, FAQ, newsletter. */
  schemes: { hero: Scheme; trust: Scheme; benefits: Scheme; steps: Scheme; story: Scheme; faq: Scheme; newsletter: Scheme };
  heroLayout: "split" | "center";
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
};

export const isStoreStyle = (s: unknown): s is StoreStyleId => typeof s === "string" && (STORE_STYLE_IDS as readonly string[]).includes(s);

/** One Google Fonts stylesheet with every style's fonts, for the dashboard previews. */
export const STORE_STYLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;600&family=Cormorant+Garamond:wght@600" +
  "&family=Fraunces:wght@500&family=Fredoka:wght@600&family=Inter:wght@400;600&family=Nunito:wght@400;700" +
  "&family=Plus+Jakarta+Sans:wght@400;700&family=Space+Grotesk:wght@600&display=swap";
