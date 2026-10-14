import { describe, expect, it } from "vitest";
import { DEFAULT_HOME, homePlan, lookNote, siteFonts, siteLook } from "./lib/siteMirror";

const section = (name: string, body = "") => `<div id="shopify-section-template--1952__${name}" class="shopify-section">${body}</div>`;

// Like earthlyderm.com (Palo Alto theme, October 2026): its section names, theme variables and fonts.
const home = [
  `<style>:root{--COLOR-BG:#ffffff;--COLOR-TEXT:#0b0b0b;--PRIMARY-BUTTONS-COLOR-BG:#2c5801;--PRIMARY-BUTTONS-COLOR-TEXT:#ffffff;--FONT-STACK-HEADING:Poppins, sans-serif;--FONT-STACK-BODY:Poppins, sans-serif}
  .a{background-color:#2c5801}.b{background-color:#f6fcf1}.c{background-color:#f6fcf1}.d{font-family:'Harmonia Sans Pro Cyr', sans-serif}</style>`,
  `<div id="shopify-section-sections--1__header"></div>`,
  section("section_hero_banner_2_NFRiTr", "<p>12,867+ 5-star reviews</p>"),
  section("section_hero_banner_2_NFRiTr"),
  section("section_promo_bar_W6txNw"),
  section("section_reviews_slider_UQ3V97", "<h2>500,000+ Successful Skin Transformations</h2>"),
  section("section_what_to_expect_nXxXNh"),
  section("section-marquee-1"),
  section("pdp_glow_section_txREF8"),
  section("section_video_grid_ab12cd"),
  section("section_image_with_text_NRBaL6"),
  section("pdp_faqs_section_3tWAzC"),
  section("pdp_moneyback_section_8zFwEK"),
].join("\n");

describe("siteMirror", () => {
  it("turns a store's home page sections into ours, in its order, each once", () => {
    const plan = homePlan(home);
    expect(plan.sections).toEqual(["hero", "marquee", "reviews", "timeline", "benefits", "story", "faq", "guarantee"]);
    expect(plan.copied[0]).toBe("Home page: Hero → Scrolling text → Reviews → What to expect → Benefits → Photo + text → FAQ → Money-back guarantee");
    const skipped = plan.skipped.join("\n");
    expect(skipped).toMatch(/video wall/);
    expect(skipped).toMatch(/500,000\+/);
    expect(skipped).toMatch(/results vary/);
  });

  it("puts the hero first and keeps reviews, and falls back to our order when it can't read the page", () => {
    expect(homePlan([section("faq"), section("image_with_text"), section("slideshow"), section("newsletter")].join("")).sections).toEqual([
      "hero",
      "faq",
      "story",
      "reviews",
      "newsletter",
    ]);
    expect(homePlan("<html><body>A page builder</body></html>")).toMatchObject({ sections: DEFAULT_HOME, copied: [] });
  });

  it("reads the store's colors and Google fonts", () => {
    const look = siteLook(home);
    expect(look.colors).toEqual({ bg: "#ffffff", surface: "#f6fcf1", text: "#0b0b0b", accent: "#2c5801", accentText: "#ffffff" });
    expect(look.fonts).toEqual({ head: "Poppins", body: "Poppins" });
    expect(lookNote(look)).toEqual(["Colors: #2c5801 buttons and accents, #f6fcf1 soft backgrounds, #0b0b0b text", "Fonts: Poppins"]);
    // Dawn's rgb triplets and font variables.
    const dawn = siteLook(":root{--color-button: 196,30,58;--color-background: 255,255,255;--color-foreground: 18,18,18;--font-heading-family: Playfair Display, serif;--font-body-family: Lato, sans-serif}");
    expect(dawn.colors).toMatchObject({ accent: "#c41e3a", bg: "#ffffff", text: "#121212" });
    expect(dawn.fonts).toEqual({ head: "Playfair Display", body: "Lato" });
    // Fonts that aren't on Google Fonts and gray-only pages are left to the chosen style.
    expect(siteFonts("body{font-family:'Harmonia Sans Pro Cyr', sans-serif}")).toBeUndefined();
    expect(siteLook("body{background-color:#ffffff;color:#222222}").colors).toBeUndefined();
  });
});
