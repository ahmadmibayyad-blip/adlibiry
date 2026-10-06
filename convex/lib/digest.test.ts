import { describe, expect, it } from "vitest";
import { isDigestDue, localTime, pickDigestWinners, renderDigestHtml, type DigestWinner } from "./digest";

const at = (iso: string) => Date.parse(iso);

describe("morning digest timing", () => {
  it("uses the user's own timezone", () => {
    expect(localTime(at("2026-10-07T06:30:00Z"), "Europe/Copenhagen")).toEqual({ day: "2026-10-07", hour: 8 });
    expect(localTime(at("2026-10-07T06:30:00Z"), "America/New_York")).toEqual({ day: "2026-10-07", hour: 2 });
    expect(localTime(at("2026-10-07T06:30:00Z"), "Not/AZone")).toEqual({ day: "2026-10-07", hour: 6 }); // falls back to UTC
  });

  it("is due once, in the morning", () => {
    expect(isDigestDue(at("2026-10-07T06:30:00Z"), "Europe/Copenhagen", undefined)).toEqual({ due: true, day: "2026-10-07" });
    expect(isDigestDue(at("2026-10-07T06:30:00Z"), "Europe/Copenhagen", "2026-10-07").due).toBe(false); // already sent today
    expect(isDigestDue(at("2026-10-07T03:00:00Z"), "Europe/Copenhagen", undefined).due).toBe(false); // 05:00 there
    expect(isDigestDue(at("2026-10-07T14:00:00Z"), "Europe/Copenhagen", undefined).due).toBe(false); // afternoon
  });
});

describe("morning digest contents", () => {
  const w = (title: string, niche: string, score: number, enteredDay: string): DigestWinner => ({
    title, niche, score, enteredDay, productId: title, imageUrl: "", category: niche,
  });
  const rows = [
    w("Old pet bed", "Pet Supplies", 95, "2026-09-01"),
    w("Cat fountain", "Pet Supplies", 80, "2026-10-07"),
    w("Dog mat", "Pet Supplies", 90, "2026-10-06"),
    w("Lipstick", "Beauty", 99, "2026-10-07"),
  ];

  it("picks new winners in the user's niches, best first", () => {
    expect(pickDigestWinners(rows, ["Pet Supplies"], "2026-10-07").map((r) => r.title)).toEqual(["Dog mat", "Cat fountain"]);
    expect(pickDigestWinners(rows, [], "2026-10-07").map((r) => r.title)).toEqual(["Lipstick", "Dog mat", "Cat fountain"]);
  });

  it("has an unsubscribe link and escapes product text", () => {
    const html = renderDigestHtml({
      winners: [w("<script>x</script> Mat", "Pet Supplies", 90, "2026-10-07")],
      alerts: [{ title: "PawCo launched 2 new ads", body: "b", link: "/dashboard/ads/1" }],
      appUrl: "https://adspypro.net",
      unsubscribeUrl: "https://adspypro.net/unsubscribe?token=abc",
      niches: ["Pet Supplies"],
    });
    expect(html).toContain('href="https://adspypro.net/unsubscribe?token=abc"');
    expect(html).toContain("Your alerts");
    expect(html).not.toContain("<script>x</script>");
  });
});
