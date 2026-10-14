// Launch → "Special requests": what the store owner typed for the AI. The copy requests read it as they
// are; for a Full store on our theme a small request also turns it into look changes (DesignWishes), checked
// here before they become Theme settings: real colors with readable text, fonts from Google Fonts, our shapes
// and layouts. storeKit.ts themeOverrides applies them over the style (and a mirrored store's look). Pure.

import { GOOGLE_FONTS, fontWeights, readableOn } from "./siteMirror";

export const MAX_WISHES = 600;

export type DesignWishes = {
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  roundness?: "square" | "soft" | "round";
  uppercase?: boolean;
  heroLayout?: "split" | "center";
  headingFont?: string;
  bodyFont?: string;
  /** What changed, for the launch's result. */
  changed: string[];
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined);
const font = (v: unknown) => GOOGLE_FONTS.find((f) => typeof v === "string" && f.toLowerCase() === v.trim().toLowerCase());

/** The AI's answer, checked: unknown fonts and values drop out, and text that wouldn't be readable on the background drops out. */
export function cleanDesign(raw: unknown): DesignWishes | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d: DesignWishes = { changed: [] };
  const background = hex(r.background);
  const text = hex(r.text);
  // A background without text that reads on it (or the other way round) would make the store unreadable.
  if (background && text ? readableOn(text, background) : true) {
    if (background) d.background = background;
    if (text) d.text = text;
  }
  const accent = hex(r.accent);
  if (accent) d.accent = accent;
  const surface = hex(r.surface);
  if (surface) d.surface = surface;
  if (r.roundness === "square" || r.roundness === "soft" || r.roundness === "round") d.roundness = r.roundness;
  if (typeof r.uppercase === "boolean") d.uppercase = r.uppercase;
  if (r.heroLayout === "split" || r.heroLayout === "center") d.heroLayout = r.heroLayout;
  const head = font(r.headingFont);
  if (head) d.headingFont = head;
  const body = font(r.bodyFont);
  if (body) d.bodyFont = body;

  if (d.accent) d.changed.push(`Accent color ${d.accent}`);
  if (d.background || d.text || d.surface) d.changed.push(`Colors: ${[d.background && `background ${d.background}`, d.surface && `soft background ${d.surface}`, d.text && `text ${d.text}`].filter(Boolean).join(", ")}`);
  if (d.headingFont || d.bodyFont) d.changed.push(`Fonts: ${[d.headingFont && `${d.headingFont} headings`, d.bodyFont && `${d.bodyFont} text`].filter(Boolean).join(", ")}`);
  if (d.roundness) d.changed.push(`Shapes: ${d.roundness}`);
  if (d.uppercase !== undefined) d.changed.push(d.uppercase ? "Uppercase headings" : "Normal-case headings");
  if (d.heroLayout) d.changed.push(d.heroLayout === "center" ? "Centered hero" : "Hero with the photo beside the text");
  return d.changed.length ? d : undefined;
}

const RADIUS = { square: 0, soft: 10, round: 22 } as const;

/** Theme settings for the wishes, over `current` (the style's, or a mirrored store's): a new accent gets readable button text. */
export function designSettings(d: DesignWishes, current: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.background) out.color_bg = d.background;
  if (d.surface) out.color_surface = d.surface;
  if (d.text) out.color_text = d.text;
  const text = String(out.color_text ?? current.color_text ?? "#111111");
  const bg = String(out.color_bg ?? current.color_bg ?? "#ffffff");
  // A text color that no longer reads on the background (only one of them changed) takes the other side.
  if (!readableOn(text, bg)) out.color_text = readableOn("#111111", bg) ? "#111111" : "#ffffff";
  if (d.accent) {
    out.color_accent = d.accent;
    out.color_accent_text = readableOn("#ffffff", d.accent) ? "#ffffff" : "#111111";
  }
  if (d.roundness) {
    out.radius = RADIUS[d.roundness];
    out.button_pill = d.roundness === "round";
  }
  if (d.uppercase !== undefined) out.heading_uppercase = d.uppercase;
  if (d.headingFont || d.bodyFont) {
    const head = d.headingFont ?? (String(current.custom_head_font ?? "") || d.bodyFont!);
    const body = d.bodyFont ?? (String(current.custom_body_font ?? "") || d.headingFont!);
    const w = fontWeights(head, body);
    Object.assign(out, { custom_head_font: head, custom_body_font: body, custom_head_weight: String(w.headWeight), custom_body_weights: w.bodyWeights });
  }
  return out;
}

export const DESIGN_GUIDE =
  "The store owner wrote special requests for their store. Turn only what they ask about the LOOK into these fields, and leave every " +
  "field they don't mention null: accent (buttons and highlights), background, surface (soft section background), text: colors as " +
  "#rrggbb; roundness: square, soft or round; uppercase: true/false for headings; heroLayout: split (photo beside the text) or center; " +
  `headingFont, bodyFont: one of ${GOOGLE_FONTS.join(", ")}. Pick colors that read well together.`;
