import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REMAKE_ACTORS,
  composeTracks,
  estimateSeconds,
  monthStart,
  mp3Seconds,
  photoProblem,
  planShots,
  productPrompt,
  remakePack,
  remakeSecondsLimit,
  seedanceDuration,
  splitCharge,
  type Segment,
} from "./remake";

describe("remake rules", () => {
  it("has eight actors, four of each gender", () => {
    expect(REMAKE_ACTORS.map((a) => a.id)).toEqual(["maya", "sofia", "emma", "aisha", "liam", "noah", "omar", "lucas"]);
    expect(REMAKE_ACTORS.filter((a) => a.gender === "female")).toHaveLength(4);
  });

  it("ships a small portrait for every actor", () => {
    for (const a of REMAKE_ACTORS) {
      const file = `public/actors/${a.id}.jpg`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(400_000);
    }
  });

  it("drops blank lines and starts with the actor", () => {
    const s = planShots([
      { scene: "Close-up of the product", voiceover: "Look at this" },
      { scene: "x", voiceover: "  " },
      { scene: "Hands unboxing it", voiceover: "Opening it" },
    ]);
    expect(s.map((x) => x.kind)).toEqual(["actor", "product"]);
    expect(s[0]).toMatchObject({ text: "Look at this", scene: "Close-up of the product" });
  });

  it("caps product shots at 2", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({ scene: "product demo", voiceover: `line ${i}` }));
    expect(planShots(lines).filter((x) => x.kind === "product")).toHaveLength(2);
  });

  it("joins talking lines in a row into one actor clip", () => {
    const s = planShots([
      { scene: "a", voiceover: "My dog was hot." },
      { scene: "Woman talks to camera in kitchen", voiceover: "Every summer." },
      { scene: "Close-up of the mat", voiceover: "Then I found this." },
      { scene: "Talks to camera", voiceover: "Now he sleeps all night." },
    ]);
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ["actor", "My dog was hot. Every summer."],
      ["product", "Then I found this."],
      ["actor", "Now he sleeps all night."],
    ]);
  });

  it("estimates 2.5 words a second, at least 1 s a line", () => {
    expect(estimateSeconds([{ voiceover: "one two three four five" }, { voiceover: "hi" }])).toBe(3);
    expect(estimateSeconds([{ voiceover: "   " }])).toBe(0);
    // Text without spaces (or Chinese, Thai...) is counted by characters: about 15 a second.
    expect(estimateSeconds([{ voiceover: "x".repeat(400) }])).toBe(27);
  });

  it("reads CBR mp3 length", () => {
    expect(mp3Seconds(80_000)).toBe(5);
    expect(mp3Seconds(12_345)).toBe(0.77);
  });

  it("clamps seedance duration", () => {
    expect(seedanceDuration(0.4)).toBe("2");
    expect(seedanceDuration(4.2)).toBe("5");
    expect(seedanceDuration(30)).toBe("12");
  });

  it("writes a product shot prompt", () => {
    const p = productPrompt("Close-up of the mug on a desk", "Thermo mug");
    expect(p).toBe("Close-up of the mug on a desk. The product: Thermo mug. Vertical phone video, natural light, realistic, no text on screen.");
    expect(productPrompt("x".repeat(900), "y").length).toBe(600);
  });

  it("gives each tier its monthly seconds", () => {
    expect(remakeSecondsLimit({ role: "admin" }, {})).toBeNull();
    expect(remakeSecondsLimit({ role: "admin" }, { REMAKE_SECONDS_ADMIN: "5" })).toBeNull();
    expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, {})).toBe(60);
    expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, { REMAKE_SECONDS_PAID: "90" })).toBe(90);
    expect(remakeSecondsLimit({ plan: "pro", subscriptionStatus: "active" }, { REMAKE_SECONDS_PAID: "lots" })).toBe(60);
    expect(remakeSecondsLimit({ proTrialEndsAt: Date.now() + 60_000 }, {})).toBe(15);
    expect(remakeSecondsLimit({}, {})).toBe(0);
    expect(remakeSecondsLimit(null, {})).toBe(0);
  });

  it("starts the month at UTC midnight on the 1st", () => {
    expect(monthStart(Date.UTC(2026, 9, 21, 15, 30))).toBe(Date.UTC(2026, 9, 1));
  });

  it("uses this month's seconds before bought ones", () => {
    expect(splitCharge(10, 4, 30)).toEqual({ monthly: 4, extra: 6 });
    expect(splitCharge(10, 20, 0)).toEqual({ monthly: 10, extra: 0 });
    expect(splitCharge(10, null, 0)).toEqual({ monthly: 10, extra: 0 });
    expect(splitCharge(10, -3, 30)).toEqual({ monthly: 0, extra: 10 });
    expect(splitCharge(10, 3, 5)).toBeNull();
  });

  it("reads the pack from env", () => {
    expect(remakePack({})).toEqual({ seconds: 30, cents: 900 });
    expect(remakePack({ REMAKE_PACK_SECONDS: "60", REMAKE_PACK_CENTS: "1500" })).toEqual({ seconds: 60, cents: 1500 });
    expect(remakePack({ REMAKE_PACK_CENTS: "-1" })).toEqual({ seconds: 30, cents: 900 });
  });

  it("takes only small photos", () => {
    const bad = "Upload a JPG, PNG or WebP photo under 8 MB.";
    expect(photoProblem({ size: 1000, contentType: "image/webp" })).toBeNull();
    expect(photoProblem({ size: 1000 })).toBeNull();
    expect(photoProblem({ size: 1000, contentType: "application/pdf" })).toBe(bad);
    expect(photoProblem({ size: 9 * 1024 * 1024, contentType: "image/png" })).toBe(bad);
    expect(photoProblem(null)).toBe(bad);
  });

  it("lays segments end to end", () => {
    const segs = [
      { kind: "actor", text: "", scene: "", audioUrl: "a1", audioSeconds: 2, videoUrl: "v1" },
      { kind: "product", text: "", scene: "", audioUrl: "a2", audioSeconds: 3.5, videoUrl: "v2" },
    ] as Segment[];
    const [video, audio] = composeTracks(segs, true);
    expect(video).toMatchObject({ id: "video", type: "video" });
    expect(video.keyframes).toEqual([
      { url: "v1", timestamp: 0, duration: 2000 },
      { url: "v2", timestamp: 2000, duration: 3500 },
    ]);
    expect(audio).toMatchObject({ id: "voice", type: "audio" });
    expect(audio.keyframes).toEqual([{ url: "a2", timestamp: 2000, duration: 3500 }]); // actor audio rides in its own clip
    expect(composeTracks(segs, false)[1].keyframes).toHaveLength(2);
  });
});
