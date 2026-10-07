import { describe, expect, it } from "vitest";
import { engagement, hookText, isoWeek, pickHooks } from "./hooks";

const ad = (o: Partial<{ headline: string; bodyText: string; views: string; likes: number; impressions: number }>) => ({
  headline: "", bodyText: "", views: "0", likes: 0, ...o,
});

describe("hooks", () => {
  it("takes the first sentence of the ad text, else the headline", () => {
    expect(hookText(ad({ bodyText: "Stop scrolling if your back hurts! This brace fixes it.", headline: "Posture brace" }))).toBe(
      "Stop scrolling if your back hurts!",
    );
    expect(hookText(ad({ bodyText: "GMV $17K", headline: "Which one is better? Ninja vs Keurig" }))).toBe("Which one is better? Ninja vs Keurig");
    expect(hookText(ad({ bodyText: "", headline: "TikTok ad" }))).toBeNull();
    expect(hookText(ad({ bodyText: "Hi", headline: "Ok" }))).toBeNull();
  });

  it("ranks by engagement and drops repeated hooks", () => {
    const picked = pickHooks(
      [
        ad({ headline: "POV: you finally found the perfect mat", views: "1.2M", likes: 100 }),
        ad({ headline: "POV: You finally found the perfect mat!", views: "3M" }),
        ad({ headline: "Nobody talks about this kitchen hack", views: "500K", likes: 90000 }),
        ad({ headline: "tiktok ad", views: "9M" }),
      ],
      5,
    );
    expect(picked.map((p) => p.hook)).toEqual(["POV: You finally found the perfect mat!", "Nobody talks about this kitchen hack"]);
    expect(engagement(ad({ views: "1K", likes: 1 }))).toBe(1020);
  });

  it("labels ISO weeks", () => {
    expect(isoWeek(Date.parse("2026-10-02T12:00:00Z"))).toBe("2026-W40");
    expect(isoWeek(Date.parse("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(Date.parse("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});

describe("angles and spoken hooks (roadmap P2-B)", () => {
  it("finds the crowded angle and the unclaimed ones", async () => {
    const { angleSummary } = await import("./hooks");
    const s = angleSummary(["Social proof", "Social proof", "Social proof", "Question", "Problem → solution", "Other"])!;
    expect(s.crowded).toEqual({ type: "Social proof", share: 0.6 });
    expect(s.unclaimed).toContain("This vs that");
    expect(s.unclaimed).not.toContain("Question");
    expect(angleSummary(["Question", "Other"])).toBeNull();
  });

  it("takes a video's first 3 seconds, finishing the sentence", async () => {
    const { spokenHook, hookText } = await import("./hooks");
    const w = (word: string, start: number) => ({ word, punctuated_word: word, start, end: start + 0.3 });
    expect(spokenHook([w("Stop", 0.1), w("scrolling", 0.4), w("if", 1), w("your", 1.3), w("dog", 2.8), w("hates", 3.2), w("summer.", 3.6), w("Here's", 4), w("why", 4.4)])).toBe(
      "Stop scrolling if your dog hates summer.",
    );
    expect(spokenHook([w("Hi", 0.2)])).toBeNull();
    expect(hookText({ headline: "Cooling mat", bodyText: "Buy now.", views: "1K", likes: 0, spokenHook: "Stop scrolling if your dog hates summer." })).toBe(
      "Stop scrolling if your dog hates summer.",
    );
  });
});
