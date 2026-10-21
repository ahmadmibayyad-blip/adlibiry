import { describe, expect, it } from "vitest";
import { showcaseTitleRank } from "./showcaseTitle";

describe("showcaseTitleRank", () => {
  it("rejects ad headlines", () => {
    for (const t of [
      "Get 50% off your first box",
      "The most versatile bags we have ever created",
      "Shop now and save",
      "Want ads that work?",
      "Free shipping on all orders",
    ]) {
      expect(showcaseTitleRank(t), t).toBe(0);
    }
  });

  it("ranks long and brand-tagged titles below short product names", () => {
    expect(showcaseTitleRank("[Glowlab Ufficiale] Zero Pore Blackhead Mud Mask")).toBe(1);
    expect(
      showcaseTitleRank("Apple EarPods Headphones with USB-C Plug Wired Ear Buds with Built-in Remote to Control Music Phone Calls"),
    ).toBe(1);
    expect(showcaseTitleRank("Grandpeak High Back Chair")).toBe(2);
    expect(showcaseTitleRank("Self-cleaning slicker brush for dogs and cats")).toBe(2);
  });

  it("puts vague names below real ones, and big brands with the headlines", () => {
    expect(showcaseTitleRank("Starter Kit")).toBe(1);
    expect(showcaseTitleRank("Shark Navigator Lift-Away Vacuum")).toBe(0);
    expect(showcaseTitleRank("Dyson cordless stick vacuum")).toBe(0);
    expect(showcaseTitleRank("[medicube Ufficiale] Zero Pore Blackhead Mud Mask")).toBe(0); // a big brand since 303e7ef
    expect(showcaseTitleRank("Cordless handheld car vacuum")).toBe(2);
  });

  it("doesn't mistake words inside product names for headline words", () => {
    expect(showcaseTitleRank("Offset spatula set")).toBe(2);
    expect(showcaseTitleRank("Ourika argan oil")).toBe(2);
  });
});
