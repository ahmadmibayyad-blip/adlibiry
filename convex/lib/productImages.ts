// More photos for a product, from its store page (convex/productImages.ts).
// Shopify: the public /products/<handle>.js lists every photo. Amazon: the
// page's "hiRes" photos. Other shops: og:image / twitter:image / JSON-LD.

export const MAX_IMAGES = 12;

const absolute = (u: string, base: string): string | null => {
  try {
    const url = new URL(u.startsWith("//") ? `https:${u}` : u, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

// "https://shop.com/collections/x/products/mat?variant=1" → "https://shop.com/products/mat.js"
export function shopifyJsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const handle = u.pathname.match(/\/products\/([^/?#.]+)/)?.[1];
    return handle ? `${u.origin}/products/${handle}.js` : null;
  } catch {
    return null;
  }
}

export function imagesFromShopifyJs(body: unknown, base: string): string[] {
  const images = (body as { images?: unknown; media?: unknown })?.images;
  if (!Array.isArray(images)) return [];
  return images
    .map((i) => (typeof i === "string" ? i : typeof (i as { src?: unknown })?.src === "string" ? (i as { src: string }).src : ""))
    .map((i) => absolute(i, base))
    .filter((i): i is string => !!i);
}

const decode = (s: string) => s.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");

export function imagesFromHtml(html: string, base: string): string[] {
  const found: string[] = [];
  // Amazon product photos (large versions).
  for (const m of html.matchAll(/"hiRes":"(https:[^"]+)"/g)) found.push(decode(m[1]));
  // Social preview images.
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi)) {
    const content = m[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (content) found.push(decode(content));
  }
  // JSON-LD product data.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== "object") return;
        const o = v as Record<string, unknown>;
        const img = o.image;
        const urlOf = (i: unknown) => (typeof i === "string" ? i : typeof (i as { url?: unknown })?.url === "string" ? (i as { url: string }).url : null);
        for (const i of Array.isArray(img) ? img : img ? [img] : []) {
          const u = urlOf(i);
          if (u) found.push(u);
        }
        if (o["@graph"]) walk(o["@graph"]);
      };
      walk(JSON.parse(m[1]));
    } catch {
      // ignore broken JSON-LD
    }
  }
  return found.map((u) => absolute(u, base)).filter((u): u is string => !!u);
}

// Unique photos, without the one the product already shows, at most MAX_IMAGES.
export function cleanImages(images: string[], mainImage: string): string[] {
  const key = (u: string) => u.replace(/^https?:/, "").replace(/[?#].*$/, "");
  const seen = new Set([key(mainImage)]);
  const out: string[] = [];
  for (const u of images) {
    if (/\.(svg|gif)(\?|$)/i.test(u) || /logo|favicon|sprite|placeholder/i.test(u)) continue;
    const k = key(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}
