// Launch → Full store on Shopify's Dawn theme (shopify-theme-dawn/, bundled by
// scripts/build-theme.mjs) instead of our AdSpy Storefront theme: the same store
// copy, style colors and fonts, written into Dawn's own settings and sections.
// Only storeThemeHttp.ts imports this, so Dawn's files stay out of other functions' bundles.

import { STORE_MENU_HANDLES, STORE_PAGE_HANDLES, bundleDeals, bundleSettings, type StoreCopy, type ThemeInput } from "./storeKit";
import { DEFAULT_SECTIONS } from "./pageMirror";
import { STORE_STYLES, type StoreStyleId } from "./storeStyles";
import { designSettings } from "./designWishes";
import { DAWN_BINARY, DAWN_FILES } from "./dawnFiles.generated";

/** Each style's fonts from Shopify's font library (Cormorant Garamond isn't in it; Cormorant is). */
export const DAWN_FONTS: Record<StoreStyleId, { head: string; body: string }> = {
  fresh: { head: "plus_jakarta_sans_n7", body: "plus_jakarta_sans_n4" },
  bold: { head: "archivo_black_n4", body: "archivo_n4" },
  luxe: { head: "cormorant_n6", body: "inter_n4" },
  playful: { head: "fredoka_n6", body: "nunito_n4" },
  nordic: { head: "fraunces_n5", body: "inter_n4" },
  tech: { head: "space_grotesk_n6", body: "inter_n4" },
  // The newer looks use Dawn fonts we know Shopify's library has, close to their Google fonts.
  glow: { head: "plus_jakarta_sans_n7", body: "plus_jakarta_sans_n4" },
  clinic: { head: "plus_jakarta_sans_n7", body: "inter_n4" },
  sport: { head: "archivo_black_n4", body: "inter_n4" },
  mono: { head: "space_grotesk_n6", body: "inter_n4" },
  soft: { head: "fredoka_n6", body: "nunito_n4" },
  cozy: { head: "fraunces_n5", body: "inter_n4" },
};

/** Our section backgrounds → Dawn color schemes (scheme-1 page, -2 soft, -3 accent, -4 inverted). */
const SCHEME = { base: "scheme-1", surface: "scheme-2", accent: "scheme-3", inverse: "scheme-4" } as const;

/** Store facts' trust icons → Dawn's icon-with-text icons. */
const ICONS: Record<string, string> = { truck: "truck", shield: "lock", return: "return", chat: "chat_bubble", lock: "lock", clock: "stopwatch", gift: "heart", star: "star" };

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (list: string[]) => list.map((p) => `<p>${esc(p)}</p>`).join("");
const keyed = <T>(prefix: string, items: T[], toBlock: (x: T) => Record<string, unknown>) => {
  const entries = items.map((x, i) => [`${prefix}${i + 1}`, toBlock(x)] as const);
  return { blocks: Object.fromEntries(entries), block_order: entries.map(([k]) => k) };
};

/** Dawn's settings_data.json with the style's colors, fonts and corners, and our cart drawer. */

/** The copy without accent [brackets] (lib/storeKit.ts STORE_GUIDE asks for them in headings). */
const plain = (v: unknown): unknown =>
  typeof v === "string" ? v.replace(/[[\]]/g, "") : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
const plainCopy = (c: StoreCopy) => plain(c) as StoreCopy;

export function dawnSettings(t: ThemeInput): Record<string, unknown> {
  const original = JSON.parse(DAWN_FILES["config/settings_data.json"]) as { presets: Record<string, Record<string, unknown>> };
  const base = original.presets.Dawn ?? {};
  const style = STORE_STYLES[t.style].settings;
  // The look from a screenshot or the special requests (lib/designWishes.ts): its colors and corners. Dawn keeps its own fonts.
  const c = { ...style, ...(t.design ? designSettings(t.design, style) : {}) } as typeof style;
  const scheme = (background: string, text: string, button: string, label: string) => ({
    settings: { background, background_gradient: "", text, button, button_label: label, secondary_button_label: text, shadow: text },
  });
  const radius = c.radius;
  const current = {
    ...base,
    color_schemes: {
      "scheme-1": scheme(c.color_bg, c.color_text, c.color_accent, c.color_accent_text),
      "scheme-2": scheme(c.color_surface, c.color_text, c.color_accent, c.color_accent_text),
      "scheme-3": scheme(c.color_accent, c.color_accent_text, c.color_accent_text, c.color_accent),
      "scheme-4": scheme(c.color_text, c.color_bg, c.color_bg, c.color_text),
      "scheme-5": scheme(c.color_sale, "#ffffff", "#ffffff", c.color_sale),
    },
    type_header_font: DAWN_FONTS[t.style].head,
    type_body_font: DAWN_FONTS[t.style].body,
    page_width: 1200,
    buttons_radius: c.button_pill ? 40 : radius,
    inputs_radius: Math.min(radius, 20),
    variant_pills_radius: 40,
    card_corner_radius: radius,
    collection_card_corner_radius: radius,
    blog_card_corner_radius: radius,
    text_boxes_radius: radius,
    media_radius: radius,
    popup_corner_radius: radius,
    badge_corner_radius: 40,
    sale_badge_color_scheme: "scheme-5",
    sold_out_badge_color_scheme: "scheme-4",
    card_color_scheme: "scheme-2",
    cart_type: "drawer",
    cart_color_scheme: "scheme-1",
  };
  return { current, presets: original.presets };
}

/** The store-specific files that replace Dawn's defaults: settings, home and product page, header and footer. */
export function dawnOverrides(t: ThemeInput): Record<string, string> {
  const style = STORE_STYLES[t.style];
  // Dawn has no accent words: the [brackets] our theme turns into italics go.
  const c = plainCopy(t.copy);
  const sc = style.schemes;
  const aboutUrl = `/pages/${t.pageHandles?.about ?? STORE_PAGE_HANDLES.about}`;
  const trust = c.trust.slice(0, 3);
  const trustBlock = trust.length
    ? {
        trust: {
          type: "icon-with-text",
          settings: Object.fromEntries(
            [1, 2, 3].flatMap((n) => {
              const item = trust[n - 1];
              return [
                [`icon_${n}`, item ? (ICONS[item.icon] ?? "check_mark") : "none"],
                [`heading_${n}`, item?.text ?? ""],
              ];
            }).concat([["layout", "vertical"]]),
          ),
        },
      }
    : {};
  // Benefit lines from the product page's copy (adspy.page metafield), inside the buy box. Liquid
  // settings only see global objects (not `section` or the section's variables), so the home page's
  // featured product is looked up by handle; product pages use the page's `product`.
  const benefitsLiquid = (productExpr: string) =>
    `{%- assign p = ${productExpr} -%}{%- assign d = p.metafields.adspy.page.value -%}{%- if d.benefits.size > 0 -%}` +
    '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.6rem">{%- for b in d.benefits limit: 4 -%}' +
    '<li style="display:flex;gap:.8rem"><span aria-hidden="true">✓</span><span>{{ b | escape }}</span></li>{%- endfor -%}</ul>{%- endif -%}';
  const handle = t.productHandle.replace(/[^a-z0-9-]/gi, "");

  const sections: Record<string, unknown> = {
    hero: {
      type: "rich-text",
      settings: { color_scheme: SCHEME[sc.hero], full_width: true, content_alignment: "center", desktop_content_position: "center", padding_top: 72, padding_bottom: 72 },
      ...keyed("h", [
        ...(c.hero.eyebrow ? [{ type: "caption", settings: { caption: c.hero.eyebrow, text_style: "subtitle", text_size: "medium" } }] : []),
        { type: "heading", settings: { heading: esc(c.hero.heading || t.product.title), heading_size: "h0" } },
        ...(c.hero.text ? [{ type: "text", settings: { text: `<p>${esc(c.hero.text)}</p>` } }] : []),
        { type: "button", settings: { button_label: c.hero.button || c.menu.shop, button_link: `shopify://products/${t.productHandle}`, button_style_secondary: false } },
      ], (b) => b),
    },
    product: {
      type: "featured-product",
      settings: { product: t.productHandle, color_scheme: "scheme-1", media_size: "large", media_position: "left", image_zoom: "lightbox", padding_top: 36, padding_bottom: 36 },
      blocks: {
        title: { type: "title", settings: { heading_size: "h1" } },
        price: { type: "price" },
        benefits: { type: "custom_liquid", settings: { custom_liquid: benefitsLiquid(`all_products['${handle}']`) } },
        variant_picker: { type: "variant_picker", settings: { picker_type: "button", swatch_shape: "circle" } },
        quantity_selector: { type: "quantity_selector" },
        buy_buttons: { type: "buy_buttons", settings: { show_dynamic_checkout: true, show_gift_card_recipient: false } },
        ...trustBlock,
      },
      block_order: ["title", "price", "benefits", "variant_picker", "quantity_selector", "buy_buttons", ...Object.keys(trustBlock)],
    },
    benefits: {
      type: "multicolumn",
      settings: { title: c.benefits.heading, heading_size: "h1", columns_desktop: Math.min(4, Math.max(2, c.benefits.items.length)), column_alignment: "center", background_style: style.benefitsLayout === "cards" ? "primary" : "none", color_scheme: SCHEME[sc.benefits], columns_mobile: "1", swipe_on_mobile: false, button_label: "", padding_top: 48, padding_bottom: 48 },
      ...keyed("b", c.benefits.items, (b) => ({ type: "column", settings: { title: b.title, text: `<p>${esc(b.text)}</p>` } })),
    },
    steps: {
      type: "multicolumn",
      settings: { title: c.steps.heading, heading_size: "h1", columns_desktop: Math.min(4, Math.max(2, c.steps.items.length)), column_alignment: "left", background_style: "none", color_scheme: SCHEME[sc.steps], columns_mobile: "1", swipe_on_mobile: false, button_label: "", padding_top: 48, padding_bottom: 48 },
      ...keyed("s", c.steps.items, (x) => ({ type: "column", settings: { title: x.title, text: `<p>${esc(x.text)}</p>` } })),
    },
    story: {
      type: "rich-text",
      settings: { color_scheme: SCHEME[sc.story], full_width: true, content_alignment: "center", desktop_content_position: "center", padding_top: 56, padding_bottom: 56 },
      ...keyed("t", [
        ...(c.story.eyebrow ? [{ type: "caption", settings: { caption: c.story.eyebrow, text_style: "subtitle", text_size: "medium" } }] : []),
        { type: "heading", settings: { heading: esc(c.story.heading), heading_size: "h1" } },
        { type: "text", settings: { text: paras(c.story.paragraphs) } },
        ...(c.story.button ? [{ type: "button", settings: { button_label: c.story.button, button_link: aboutUrl, button_style_secondary: true } }] : []),
      ], (b) => b),
    },
    // Shows the product's supplier reviews when the launch added them, nothing otherwise.
    reviews: { type: "adspy-reviews", settings: { product: t.productHandle, color_scheme: sc.story === "surface" ? "scheme-1" : "scheme-2", padding_top: 48, padding_bottom: 48 } },
    faq: {
      type: "collapsible-content",
      settings: { heading: c.faq.heading, heading_size: "h1", heading_alignment: "center", layout: "none", color_scheme: SCHEME[sc.faq], container_color_scheme: "scheme-2", open_first_collapsible_row: false, padding_top: 48, padding_bottom: 48 },
      ...keyed("f", c.faq.items.slice(0, 6), (f) => ({ type: "collapsible_row", settings: { heading: f.q, icon: "question_mark", row_content: `<p>${esc(f.a)}</p>` } })),
    },
    newsletter: {
      type: "newsletter",
      settings: { color_scheme: SCHEME[sc.newsletter], full_width: true, padding_top: 48, padding_bottom: 56 },
      ...keyed("n", [
        { type: "heading", settings: { heading: c.newsletter.heading, heading_size: "h1" } },
        ...(c.newsletter.text ? [{ type: "paragraph", settings: { text: `<p>${esc(c.newsletter.text)}</p>` } }] : []),
        { type: "email_form" },
      ], (b) => b),
    },
  };
  const order = ["hero", "product", "benefits", "steps", "story", "reviews", "faq", "newsletter"].filter((k) => {
    if (k === "benefits") return c.benefits.items.length > 0;
    if (k === "steps") return c.steps.items.length > 0;
    if (k === "faq") return c.faq.items.length > 0;
    if (k === "story") return c.story.heading && c.story.paragraphs.length > 0;
    return true;
  });

  const productTemplate = dawnProductTemplate(t, trustBlock.trust, benefitsLiquid("product"));

  return {
    "config/settings_data.json": json(dawnSettings(t)),
    "templates/index.json": json({ sections: Object.fromEntries(order.map((k) => [k, sections[k]])), order }),
    "templates/product.json": json(productTemplate),
    "sections/header-group.json": json({
      type: "header",
      name: "Header",
      sections: {
        "announcement-bar": {
          type: "announcement-bar",
          settings: { color_scheme: SCHEME[sc.trust === "base" ? "inverse" : sc.trust], show_line_separator: false, auto_rotate: false },
          ...keyed("a", c.announcement ? [c.announcement] : [], (text) => ({ type: "announcement", settings: { text, link: "" } })),
        },
        header: {
          type: "header",
          settings: { color_scheme: "scheme-1", menu_color_scheme: "scheme-1", logo_position: "middle-left", menu: STORE_MENU_HANDLES.main, menu_type_desktop: "dropdown", sticky_header_type: "on-scroll-up", show_line_separator: true, mobile_logo_position: "center" },
        },
      },
      order: c.announcement ? ["announcement-bar", "header"] : ["header"],
    }),
    "sections/footer-group.json": json({
      type: "footer",
      name: "Footer",
      sections: {
        footer: {
          type: "footer",
          settings: { color_scheme: "scheme-2", newsletter_enable: true, newsletter_heading: c.newsletter.heading, show_social: true, payment_enable: true, show_policy: true },
          ...keyed("l", [
            { type: "text", settings: { heading: t.brandName, subtext: c.footerText ? `<p>${esc(c.footerText)}</p>` : "" } },
            { type: "link_list", settings: { heading: c.menu.shop, menu: STORE_MENU_HANDLES.footer } },
          ], (b) => b),
        },
      },
      order: ["footer"],
    }),
  };
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/** Every file of the store's Dawn theme: Dawn with this store's settings and pages on top. */
export function dawnThemeFiles(t: ThemeInput): Record<string, string | Uint8Array> {
  const binary = Object.fromEntries(Object.entries(DAWN_BINARY).map(([path, b64]) => [path, fromBase64(b64)]));
  return { ...DAWN_FILES, ...binary, ...dawnOverrides(t) };
}

type DawnSection = { type: string; settings?: Record<string, unknown>; blocks?: Record<string, unknown>; block_order?: string[] };

/**
 * Dawn's product page, like the stores selling with ads: stars, title, price, ticks, offer line and real
 * stock, variant buttons, bundle deals (only with Launch's discounts; they replace the quantity selector),
 * buy buttons, guarantee seal, trust icons and tabs; then photo-with-text rows, a comparison table, the
 * owner's own reviews, the supplier's reviews and the product's questions.
 */
export function dawnProductTemplate(t: ThemeInput, trust: unknown, benefitsLiquid: string) {
  const tpl = JSON.parse(DAWN_FILES["templates/product.json"]) as { sections: Record<string, DawnSection>; order: string[] };
  const pp = t.copy.productPage;
  const m = t.mirror;
  const deals = bundleDeals(t);
  const main = tpl.sections.main;
  const blocks = (main.blocks ?? {}) as Record<string, unknown>;
  // Ticks: "Bold part – detail" from the product page copy, else the product's benefit lines.
  const ticks = pp?.ticks.length
    ? '<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.8rem">' +
      pp.ticks
        .map((x) => {
          const [bold, ...rest] = x.split(" – ");
          return `<li style="display:flex;gap:.8rem"><span aria-hidden="true">✓</span><span>${rest.length ? `<strong>${esc(bold)}</strong> – ${esc(rest.join(" – "))}` : esc(x)}</span></li>`;
        })
        .join("") +
      "</ul>"
    : benefitsLiquid;
  Object.assign(blocks, {
    adspy_rating: { type: "adspy_rating", settings: {} },
    adspy_benefits: { type: "custom_liquid", settings: { custom_liquid: ticks } },
    ...(deals && pp?.offer ? { adspy_offer: { type: "text", settings: { text: `<strong>${esc(pp.offer)}</strong>`, text_style: "body" } } } : {}),
    adspy_stock: { type: "inventory", settings: { text_style: "body", inventory_threshold: 10, show_inventory_quantity: true } },
    ...(deals ? { adspy_bundles: { type: "adspy_bundles", settings: bundleSettings(deals, pp, m) } } : {}),
    ...(m?.guarantee === false ? {} : { adspy_guarantee: { type: "adspy_guarantee", settings: { days: t.facts.returnDays > 0 ? t.facts.returnDays : 0, title: "", text: "" } } }),
    ...(trust ? { adspy_trust: trust } : {}),
    ...Object.fromEntries((pp?.tabs ?? []).map((x, i) => [`adspy_tab${i + 1}`, { type: "collapsible_tab", settings: { heading: x.heading, icon: ["box", "check_mark", "clipboard"][i] ?? "check_mark", content: `<p>${esc(x.text)}</p>` } }])),
  });
  delete blocks.vendor;
  main.blocks = blocks;
  main.block_order = [
    "adspy_rating",
    "title",
    "price",
    "adspy_benefits",
    ...(blocks.adspy_offer ? ["adspy_offer"] : []),
    "adspy_stock",
    "variant_picker",
    ...(deals ? ["adspy_bundles"] : ["quantity_selector"]),
    "buy_buttons",
    "adspy_guarantee",
    ...(trust ? ["adspy_trust"] : []),
    "description",
    ...(pp?.tabs ?? []).map((_, i) => `adspy_tab${i + 1}`),
    "share",
  ].filter((k) => k in blocks);
  if (!deals) delete blocks.adspy_bundles;
  else delete blocks.quantity_selector;

  // Under the buy box. Rows show the AI photos (2nd photo on), else the main photo.
  const ai = t.aiPhotos ?? 0;
  const rows: DawnSection[] = (pp?.sections ?? []).map((x, i) => ({
    type: "adspy-image-text",
    settings: {
      image_index: ai > 0 ? 2 + (i % ai) : 1,
      image_right: i % 2 === 1,
      eyebrow: x.eyebrow,
      heading: x.heading,
      text: `<p>${esc(x.text)}</p>`,
      points: x.points.join("\n"),
      button_label: i === 0 ? "" : pp?.button ?? "",
      color_scheme: i % 2 === 0 ? "scheme-1" : "scheme-2",
      padding_top: 48,
      padding_bottom: 48,
    },
  }));
  const after: [string, DawnSection][] = [];
  let row = 0;
  // Dawn has no guarantee section: the seal in the buy box stands in for it.
  for (const kind of m?.sections ?? DEFAULT_SECTIONS) {
    if (kind === "row") {
      if (rows[row]) after.push([row === 0 ? "adspy_problem" : `adspy_row${row + 1}`, rows[row]]);
      row++;
    } else if (kind === "comparison") {
      if (pp && pp.comparison.rows.length >= 3) {
        after.push(["adspy_comparison", {
          type: "adspy-comparison",
          settings: { heading: pp.comparison.heading, us_label: t.brandName, them_1: pp.comparison.others, button_label: pp.button, color_scheme: "scheme-2", padding_top: 48, padding_bottom: 48 },
          ...keyed("row", pp.comparison.rows, (r) => ({ type: "row", settings: { feature: r.feature, us: r.us, them_1: r.others } })),
        }]);
      }
    } else if (kind === "reviews") {
      after.push(["adspy_testimonials", { type: "adspy-testimonials", settings: { heading: pp?.reviewsHeading ?? "", color_scheme: "scheme-2", padding_top: 48, padding_bottom: 48 } }]);
      after.push(["adspy_reviews", { type: "adspy-reviews" }]);
    } else if (kind === "faq") {
      after.push(["adspy_faq", { type: "adspy-product-faq" }]);
    }
  }
  for (const [key, section] of after) tpl.sections[key] = section;
  const mainAt = tpl.order.indexOf("main");
  tpl.order.splice(mainAt + 1, 0, ...after.map(([k]) => k));
  return tpl;
}
