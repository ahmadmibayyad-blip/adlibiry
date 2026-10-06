import { describe, expect, it } from "vitest";
import { convexUrlFromHtml, injectStats } from "../../api/landing";

const page = `<!doctype html><html><head><meta name="convex-url" content="https://careful-raccoon-363.convex.cloud" /></head><body><div id="root"></div></body></html>`;
const stats = {
  ads: { total: 12345, activeCount: 678, countries: [{ value: "US", n: 9 }, { value: "DE", n: 4 }, { value: "DK", n: 2 }] },
  products: { total: 4321, categories: [{ value: "Pet Supplies", n: 30 }, { value: "Home & Living", n: 20 }] },
};

describe("home page numbers written by the server", () => {
  it("finds the Convex URL the build wrote into the page", () => {
    expect(convexUrlFromHtml(page)).toBe("https://careful-raccoon-363.convex.cloud");
    expect(convexUrlFromHtml(page.replace("https://careful-raccoon-363.convex.cloud", "%VITE_CONVEX_URL%"))).toBeNull();
  });

  it("puts the real counts in the HTML and hands them to the app", () => {
    const html = injectStats(page, stats);
    expect(html).toContain("12,345</dd>");
    expect(html).toContain("4,321</dd>");
    expect(html).toContain("Countries</dt><dd class=\"font-display text-3xl font-bold tabular-nums mt-1\">3</dd>");
    expect(html).toContain("watches 12,345 ads");
    expect(html).toContain('window.__ADSPY_STATS__={"ads":{"total":12345,"activeCount":678,"countries":[{"value":"US","n":9}');
    expect(html).not.toContain('<div id="root"></div>');
  });

  it("leaves the page alone when the stats look wrong", () => {
    expect(injectStats(page, null)).toBe(page);
    expect(injectStats(page, { ads: { total: "12" } })).toBe(page);
  });

  it("can't be used to inject markup", () => {
    const html = injectStats(page, { ...stats, ads: { ...stats.ads, countries: [{ value: "</script><script>alert(1)</script>", n: 1 }] } });
    expect(html).not.toContain("</script><script>alert(1)");
  });
});
