// CSV → product rows for the Admin "Import CSV" dialog.
// Handles UTF-8 / UTF-8-BOM / UTF-16 (PiPiAds exports), tab, comma and
// semicolon separators, quoted fields with commas/newlines, and maps columns
// from PiPiAds, Minea, Kalodata, Shopify exports and simple own sheets.

export type ProductRow = {
  title: string;
  imageUrl: string;
  productUrl: string;
  priceUsd?: number;
  originalPrice?: string;
  cost?: number;
  category: string;
  description?: string;
  ads?: number;
  likes?: number;
  growthPercent?: number;
  researchUrl?: string;
};

export const IMPORT_CATEGORIES = [
  "Electronics",
  "Health & Wellness",
  "Home & Living",
  "Fashion",
  "Beauty",
  "Pet Supplies",
  "Sports",
  "Toys",
  "Other",
] as const;

export function decodeCsvBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  // UTF-16 without BOM: lots of zero bytes in the first KB
  const head = b.subarray(0, 1024);
  const zeros = head.filter((x) => x === 0).length;
  if (zeros > head.length / 4) return new TextDecoder(head[0] === 0 ? "utf-16be" : "utf-16le").decode(b);
  return new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
}

export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") > 0 ? text.indexOf("\n") : 2000);
  const counts = ["\t", ",", ";"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// RFC-4180-ish parser: quotes, escaped quotes, delimiters/newlines in quotes.
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

type Field = keyof Omit<ProductRow, "category"> | "category";
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
// Earlier aliases win. PiPiAds: Link=research page, Product Link=store page.
const ALIASES: Record<Field, string[]> = {
  title: ["title", "producttitle", "productname", "name", "product"],
  imageUrl: ["productimage", "imageurl", "image", "imagesrc", "img", "thumbnail", "cover", "mainimage", "picture"],
  productUrl: ["productlink", "producturl", "storeurl", "landingpage", "landingpageurl", "url", "shopurl", "link"],
  researchUrl: ["link", "pipiadslink", "detailurl", "sourceurl"],
  priceUsd: ["usdprice", "priceusd", "pricein usd", "price", "saleprice", "retailprice", "variantprice"],
  originalPrice: ["price", "originalprice", "localprice"],
  cost: ["cost", "costprice", "suppliercost", "costperitem", "buyprice"],
  category: ["category", "niche", "producttype", "type", "collection"],
  description: ["description", "bodyhtml", "body"],
  ads: ["ads", "adcount", "activeads", "numberofads", "totalads"],
  likes: ["likes", "likecount", "totallikes", "engagement", "diggcount"],
  growthPercent: ["growthrate", "growth", "salesgrowth", "trend"],
};

export type ColumnMap = Partial<Record<Field, number>>;

export function autoMap(header: string[]): ColumnMap {
  const h = header.map(norm);
  const used = new Set<number>();
  const map: ColumnMap = {};
  const order: Field[] = ["title", "imageUrl", "productUrl", "researchUrl", "priceUsd", "originalPrice", "cost", "category", "description", "ads", "likes", "growthPercent"];
  for (const f of order) {
    for (const alias of ALIASES[f].map(norm)) {
      const idx = h.indexOf(alias);
      if (idx >= 0 && !used.has(idx)) {
        // "price" only counts as USD if there is no dedicated USD column; then it's the original price.
        if (f === "priceUsd" && alias === "price" && h.includes("usdprice")) continue;
        map[f] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // PiPiAds: "Price" is the local-currency string → keep only as originalPrice when "Usd Price" exists.
  if (map.priceUsd !== undefined && map.originalPrice === undefined) {
    const priceIdx = h.indexOf("price");
    if (priceIdx >= 0 && priceIdx !== map.priceUsd && !used.has(priceIdx)) map.originalPrice = priceIdx;
  }
  return map;
}

export function toNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const m = t.replace(/\s/g, "").match(/-?[\d.,]+/);
  if (!m) return undefined;
  let num = m[0];
  // 1.234,56 → 1234.56 ; 1,234.56 → 1234.56 ; 12,5 → 12.5
  if (num.includes(",") && num.includes(".")) num = num.lastIndexOf(",") > num.lastIndexOf(".") ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  else if (num.includes(",")) num = /,\d{3}$/.test(num) && num.split(",").length > 1 && !/^0,/.test(num) ? num.replace(/,/g, "") : num.replace(",", ".");
  let n = parseFloat(num);
  if (!Number.isFinite(n)) return undefined;
  const suffix = t.match(/([kKmM])\b/);
  if (suffix) n *= suffix[1].toLowerCase() === "k" ? 1e3 : 1e6;
  return n;
}

// Order matters: first match wins. Words end with \b where a stem would
// otherwise match inside other words (e.g. "pain" in "painting").
const KEYWORDS: [string, RegExp][] = [
  ["Pet Supplies", /\b(dogs?|cats?|pets?|puppy|puppies|kitten|leash|harness|litter|aquarium|bird ?cage|chew toy|hund|katze|perro|gato)\b/i],
  ["Toys", /\b(toys?|lego|puzzles?|doll|plush|rc car|building blocks|montessori|hot wheels|juguete|dino)\b/i],
  ["Beauty", /\b(skin ?care|serum|cream|lotion|makeup|mascara|lipstick|labial|lip (balm|gloss|oil)|balm|lash(es)?|eyebrows?|nails?|hair|shampoo|conditioner|perfume|parfum|fragrance|facial|face mask|beauty|wigs?|cosmetics?|body (wash|glaze|oil|lotion)|teeth|whitening|blanqueamiento|tooth|cepillo alisador|straightener|curler|sunscreen|spf|skin)\b/i],
  ["Health & Wellness", /\b(posture|massager?|massage|pain relief|back pain|\bpain\b|supplements?|vitamins?|gummies|protein|collagen|health|sleep|therapy|orthopedic|knee|detox|weight loss|brace|acupressure|wellness|juice|tea|matcha|probiotic|tail ?bone|cushion|pillow for)\b/i],
  ["Sports", /\b(fitness|gym|yoga|workout|dumbbells?|resistance bands?|bike|bicycle|cycling|running|runner|sports?|golf|fishing|camping|hiking|football|soccer|tennis|padel|adizero|trail|bib)\b/i],
  ["Electronics", /\b(charger|cables?|usb|bluetooth|earbuds?|headphones?|speakers?|led|smart ?watch|smart|cameras?|drones?|power ?bank|iphone|phone ?case|phone|laptop|keyboard|mouse|projector|gadget|wireless|electric|magnetic|air pump|inflator|repair|car (charger|mount)|dash ?cam|tablet|stylus)\b/i],
  ["Fashion", /\b(dress|dresses|vestido|shirts?|t-?shirt|hoodie|sweatshirt|sweater|cardigan|jacket|coat|pants?|jeans|denim|leggings|shorts|skirt|romper|jumpsuit|crop top|tops?|blouse|blazer|vest|jumper|trousers|kimono|pajamas?|robe|suit|polo|knit|shoes?|sneakers?|boots?|sandals?|heels|bags?|handbag|wallet|watch|reloj|jewel(ry|lery)?|necklace|pendant|collier|collar|rings?|earrings?|bracelet|sunglasses|glasses|hats?|caps?|gorra|socks?|lingerie|bras?|bikini|swimsuit|fashion|abaya|scarf|velvet|embroidered|silk|lace|keychain)\b/i],
  ["Home & Living", /\b(kitchen|home|decor|wall art|wall|paintings?|plaque|ornaments?|christmas|advent|calendar|lamp|furniture|chair|sofa|pillow|blanket|towel|bath|shower|clean(er|ing)?|mop|storage|organi[sz]er|garden|plants?|curtains?|rug|mattress|bedding|cookware|knife|knives|coffee|mug|candle|frame|door|windshield|car|stickers?|bell|glass|acrylic|personali[sz]ed|custom)\b/i],
];

export function guessCategory(title: string, hint?: string): string {
  const text = `${hint ?? ""} ${title}`;
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return "Other";
}

export type BuildResult = {
  rows: ProductRow[];
  total: number;
  duplicates: number;
  invalid: number;
};

export function buildRows(
  table: string[][],
  map: ColumnMap,
  opts: { category: "auto" | string },
): BuildResult {
  const [, ...data] = table;
  const seen = new Set<string>();
  const rows: ProductRow[] = [];
  let duplicates = 0;
  let invalid = 0;
  const get = (r: string[], f: Field) => (map[f] !== undefined ? (r[map[f]!] ?? "").trim() : undefined);
  for (const r of data) {
    const title = get(r, "title") ?? "";
    const imageUrl = get(r, "imageUrl") ?? "";
    if (!title || !/^https?:\/\//i.test(imageUrl)) {
      invalid++;
      continue;
    }
    const productUrl = get(r, "productUrl") ?? "";
    let key = `${title.toLowerCase()}|${imageUrl.split("?")[0]}`;
    try {
      if (productUrl) {
        const u = new URL(productUrl);
        key = `${u.hostname.replace(/^www\./, "")}${u.pathname}`.toLowerCase();
      }
    } catch {
      /* keep title key */
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const hint = get(r, "category");
    const category =
      opts.category === "auto"
        ? (hint && (IMPORT_CATEGORIES as readonly string[]).includes(hint) ? hint : guessCategory(title, hint))
        : opts.category;
    const researchUrl = get(r, "researchUrl");
    rows.push({
      title: title.slice(0, 300),
      imageUrl,
      productUrl: /^https?:\/\//i.test(productUrl) ? productUrl : "",
      priceUsd: toNumber(get(r, "priceUsd")),
      originalPrice: get(r, "originalPrice") || undefined,
      cost: toNumber(get(r, "cost")),
      category,
      description: get(r, "description") || undefined,
      ads: toNumber(get(r, "ads")),
      likes: toNumber(get(r, "likes")),
      growthPercent: toNumber(get(r, "growthPercent")),
      researchUrl: researchUrl && researchUrl !== productUrl && /^https?:\/\//i.test(researchUrl) ? researchUrl : undefined,
    });
  }
  return { rows, total: data.length, duplicates, invalid };
}

export const TEMPLATE_CSV =
  "title,image_url,product_url,price_usd,cost,category,ads,likes,growth\n" +
  '"Cooling mat for dogs",https://example.com/mat.jpg,https://yourstore.com/products/mat,39.95,9.50,Pet Supplies,12,15400,35%\n';
