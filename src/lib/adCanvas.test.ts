import { describe, expect, it } from "vitest";
import { fitText, wrapLines, type Measure } from "./adCanvas";

// Every character is half the font size wide.
const measure: Measure = (t, size) => t.length * size * 0.5;

describe("ad text layout", () => {
  it("wraps words into lines that fit", () => {
    expect(wrapLines("Gør godbidstid til en sjov leg", 20, 150, measure)).toEqual(["Gør godbidstid", "til en sjov leg"]);
    expect(wrapLines("Supercalifragilistic word", 20, 50, measure)).toEqual(["Supercalifragilistic", "word"]);
    expect(wrapLines("   ", 20, 100, measure)).toEqual([]);
  });

  it("uses the largest size that fits, and cuts with … only at the smallest", () => {
    expect(fitText("Short hook", { max: 80, min: 40, maxWidth: 1000, maxLines: 4 }, measure)).toEqual({ size: 80, lines: ["Short hook"] });
    const long = fitText("Din hund keder sig når du er væk men denne måtte giver hovedet noget at lave", { max: 80, min: 40, maxWidth: 600, maxLines: 3 }, measure);
    expect(long.size).toBeLessThan(80);
    expect(long.lines.length).toBeLessThanOrEqual(3);
    const cut = fitText("one two three four five six seven eight nine ten", { max: 40, min: 40, maxWidth: 200, maxLines: 2 }, measure);
    expect(cut.lines).toHaveLength(2);
    expect(cut.lines[1].endsWith("…")).toBe(true);
  });
});
