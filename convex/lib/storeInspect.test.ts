import { describe, expect, it } from "vitest";
import { firstProductPath, inspectHtml, mergeInspections } from "./storeInspect";

// Trimmed from real store pages (Cello theme with Kaching, UpCart, Trackpanda, Vitals, Klaviyo).
const home = `<script src="//cdn.shopify.com/s/files/1/x.js"></script>
<script>Shopify.shop = "hsmix0-tn.myshopify.com"; Shopify.locale = "sv"; Shopify.currency = {"active":"SEK","rate":"1.0"}; Shopify.country = "SE";
Shopify.theme = {"name":"Needyknee – Komplett","id":202745413979,"schema_name":"Cello","schema_version":"3.0.2","theme_store_id":null,"role":"main"};</script>
<meta property="og:site_name" content="Needy &amp; Knee">
<!-- BEGIN app block: shopify://apps/kaching-bundles/blocks/app-embed-block/abc --><!-- END app block -->
<!-- BEGIN app block: shopify://apps/trackpanda/blocks/app-embed/def -->
<script src="https://cdn.shopify.com/extensions/01a12426-f22f-7246-b870-2240aeee5c8e/upcart-2-424/assets/upcart.js"></script>
<script src="https://cdn.shopify.com/extensions/01a12bd9-18d6-78ee-a86d-40a8cce366f3/mystery-widget-12/assets/w.js"></script>
<a href="/products/needyknee-knarem">Knee</a>
"configuration":"{\\"pixel_id\\":\\"221\\",\\"pixel_type\\":\\"facebook_pixel\\"}"`;
const product = `<script src="https://cdn.shopify.com/s/x.js"></script>
<!-- BEGIN app block: shopify://apps/kaching-bundles/blocks/app-embed-block/abc -->
<!-- BEGIN app block: shopify://apps/some-new-app/blocks/embed/x -->
<link rel="preconnect" href="https://cdn-sf.vitals.app/"><script src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=X"></script>
<a href="https://www.facebook.com/needyknee">Facebook</a>`;

describe("store inspection", () => {
  it("reads the theme, apps and pixels of a page", () => {
    const r = inspectHtml(home);
    expect(r).toMatchObject({ shopify: true, myshopifyDomain: "hsmix0-tn.myshopify.com", country: "SE", currency: "SEK", locale: "sv", shopName: "Needy & Knee" });
    expect(r.theme).toEqual({
      name: "Needyknee – Komplett", schemaName: "Cello", version: "3.0.2", themeStoreId: null,
      vendor: "Webibazaar Templates", free: false, url: "https://themes.shopify.com/themes/cello",
    });
    expect(r.apps.map((a) => [a.name, a.category, a.via])).toEqual([
      ["Kaching Bundles", "Bundles & upsells", "app embed"],
      ["Trackpanda", "Order tracking", "app embed"],
      ["UpCart", "Cart", "app extension"],
      ["Mystery Widget", "Other", "app extension"],
    ]);
    expect(r.apps[0].url).toBe("https://apps.shopify.com/kaching-bundles");
    expect(r.apps[3].url).toBeUndefined(); // an extension name isn't an App Store handle
    expect(r.pixels).toEqual(["Meta (Facebook) pixel"]);
  });

  it("merges pages: apps that load on one page only, no duplicates, sorted by category", () => {
    const r = mergeInspections([inspectHtml(home), inspectHtml(product)]);
    expect(r.theme?.schemaName).toBe("Cello");
    expect(r.apps.map((a) => a.name)).toEqual(["Kaching Bundles", "UpCart", "Vitals", "Klaviyo", "Trackpanda", "Mystery Widget", "Some New App"]);
    // An unknown app embed still links to its App Store page.
    expect(r.apps.find((a) => a.key === "some-new-app")?.url).toBe("https://apps.shopify.com/some-new-app");
    // A link to the store's Facebook page isn't a pixel.
    expect(inspectHtml(product).pixels).toEqual([]);
  });

  it("knows Shopify's free themes, and pages that aren't Shopify", () => {
    expect(inspectHtml('<script>Shopify.theme = {"name":"My store","schema_name":"Dawn","schema_version":"15.0.0","theme_store_id":887};</script> cdn.shopify.com').theme).toMatchObject({
      vendor: "Shopify", free: true, themeStoreId: 887,
    });
    expect(inspectHtml("<html><body>WooCommerce</body></html>")).toMatchObject({ shopify: false, apps: [], pixels: [] });
  });

  it("finds a product page link, also in collections and translated paths", () => {
    expect(firstProductPath(home)).toBe("/products/needyknee-knarem");
    expect(firstProductPath('<a href="/sv-se/collections/all/products/x?variant=1">')).toBe("/sv-se/collections/all/products/x");
    expect(firstProductPath('<a href="/pages/about">')).toBeUndefined();
  });
});
