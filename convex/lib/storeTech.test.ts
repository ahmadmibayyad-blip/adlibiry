import { describe, expect, it } from "vitest";
import { inspectHtml } from "./storeInspect";
import { hostOf, matchesTech, storeTechFrom, techFacets, type StoreTech } from "./storeTech";

const home = `<script src="//cdn.shopify.com/s/files/1/x.js"></script>
<script>Shopify.theme = {"name":"My store","schema_name":"Cello","schema_version":"3.0.2","theme_store_id":null,"role":"main"};</script>
<!-- BEGIN app block: shopify://apps/kaching-bundles/blocks/app-embed-block/abc --><!-- END app block -->
<!-- BEGIN app block: shopify://apps/trackpanda/blocks/app-embed/def -->
"configuration":"{\\"pixel_id\\":\\"221\\",\\"pixel_type\\":\\"facebook_pixel\\"}"`;
const AT = "2026-10-18T00:00:00.000Z";

describe("store tech", () => {
  it("keeps the theme's own name, the app names and the pixels", () => {
    expect(storeTechFrom(inspectHtml(home), AT)).toEqual({
      checkedAt: AT, ok: true, theme: "Cello", apps: ["Kaching Bundles", "Trackpanda"], pixels: ["Meta (Facebook) pixel"],
    });
  });

  it("marks a page that isn't Shopify, or none, as not read", () => {
    expect(storeTechFrom(inspectHtml("<html>a blog</html>"), AT)).toEqual({ checkedAt: AT, ok: false, apps: [], pixels: [] });
    expect(storeTechFrom(null, AT).ok).toBe(false);
  });

  it("matches theme, app and pixel, ignoring case; unread stores never match", () => {
    const t: StoreTech = { checkedAt: AT, ok: true, theme: "Dawn", apps: ["Judge.me", "UpCart"], pixels: ["TikTok pixel"] };
    expect(matchesTech(t, {})).toBe(true);
    expect(matchesTech(t, { theme: "dawn", app: "upcart" })).toBe(true);
    expect(matchesTech(t, { app: "Loox" })).toBe(false);
    expect(matchesTech(t, { pixel: "TikTok pixel" })).toBe(true);
    expect(matchesTech(undefined, { theme: "Dawn" })).toBe(false);
    expect(matchesTech(undefined, {})).toBe(true);
  });

  it("counts the options, most common first", () => {
    const f = techFacets([
      { checkedAt: AT, ok: true, theme: "Dawn", apps: ["UpCart"], pixels: [] },
      { checkedAt: AT, ok: true, theme: "Dawn", apps: ["UpCart", "Loox"], pixels: ["TikTok pixel"] },
      { checkedAt: AT, ok: true, theme: "Impulse", apps: [], pixels: [] },
      { checkedAt: AT, ok: false, apps: [], pixels: [] },
      undefined,
    ]);
    expect(f.read).toBe(3);
    expect(f.themes).toEqual([{ value: "Dawn", n: 2 }, { value: "Impulse", n: 1 }]);
    expect(f.apps).toEqual([{ value: "UpCart", n: 2 }, { value: "Loox", n: 1 }]);
    expect(f.pixels).toEqual([{ value: "TikTok pixel", n: 1 }]);
  });

  it("reads a host from a link", () => {
    expect(hostOf("https://www.Shop.com/products/x")).toBe("shop.com");
    expect(hostOf("shop.dk")).toBe("shop.dk");
  });
});
