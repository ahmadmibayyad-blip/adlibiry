import { describe, expect, it } from "vitest";
import { cleanDesign, designSettings } from "./lib/designWishes";

describe("designWishes", () => {
  it("keeps the look changes asked for, checked", () => {
    const d = cleanDesign({ accent: "#E8A0BF", background: null, surface: "#fff0f6", text: null, roundness: "round", uppercase: null, heroLayout: "center", headingFont: "quicksand", bodyFont: "Comic Sans" });
    expect(d).toMatchObject({ accent: "#e8a0bf", surface: "#fff0f6", roundness: "round", heroLayout: "center", headingFont: "Quicksand" });
    expect(d?.bodyFont).toBeUndefined(); // not a Google font we know
    expect(d?.changed).toContain("Shapes: round");
    // Nothing asked about the look: no changes.
    expect(cleanDesign({ accent: null, roundness: "wobbly", headingFont: null })).toBeUndefined();
    // Text that wouldn't read on the background is dropped with it.
    expect(cleanDesign({ background: "#ffffff", text: "#f5f5f5" })).toBeUndefined();
  });

  it("turns them into Theme settings with readable button text and font weights", () => {
    const current = { color_bg: "#ffffff", color_text: "#111111", custom_head_font: "", custom_body_font: "" };
    expect(designSettings({ accent: "#e8a0bf", roundness: "round", headingFont: "Anton", changed: [] }, current)).toEqual({
      color_accent: "#e8a0bf",
      color_accent_text: "#111111",
      radius: 22,
      button_pill: true,
      custom_head_font: "Anton",
      custom_body_font: "Anton",
      custom_head_weight: "400",
      custom_body_weights: "400",
    });
    // A dark background alone flips the text to white.
    expect(designSettings({ background: "#101010", changed: [] }, current)).toEqual({ color_bg: "#101010", color_text: "#ffffff" });
  });
});
