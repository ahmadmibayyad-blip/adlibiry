import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPARE_PAGES } from "./content";
import { compareHtml } from "./staticHtml";

const shell = readFileSync("index.html", "utf8");

describe("comparison pages", () => {
  it("have unique slugs and the sitemap lists every one", () => {
    const slugs = COMPARE_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    for (const s of slugs) expect(sitemap).toContain(`https://adspypro.net/vs/${s}</loc>`);
  });

  it("write the comparison into the built page", () => {
    const p = COMPARE_PAGES[0];
    const html = compareHtml(shell.replace(/<div id="root">\s*<\/div>/, '<div id="root"></div>'), p);
    expect(html).toContain(`<title>${p.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="https://adspypro.net/vs/${p.slug}" />`);
    expect(html).toContain("<h1>");
    expect(html).toContain(p.rows[0].them.replace(/"/g, "&quot;"));
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it("escape text and leave an unexpected page alone", () => {
    const p = { ...COMPARE_PAGES[0], title: 'A <b> & "c"' };
    expect(compareHtml('<title>x</title></head><div id="root"></div>', p)).toContain("<title>A &lt;b&gt; &amp; &quot;c&quot;</title>");
    expect(compareHtml("<html>no root</html>", p)).toBe("<html>no root</html>");
  });
});
