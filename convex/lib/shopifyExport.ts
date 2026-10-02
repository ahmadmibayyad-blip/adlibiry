// Turn an AdSpy Pro product into a Shopify product: the Admin API productSet
// input (convex/shopifyImport.ts) and the product CSV Shopify imports.
// Products are created as drafts so the user reviews them before selling.

export type ExportableProduct = {
  title: string;
  description: string;
  imageUrl: string;
  price?: number;
  cost?: number;
  category: string;
  tags: string[];
};

export const SHOPIFY_API_VERSION = "2025-07";

// "My Store.myshopify.com/admin" → "my-store.myshopify.com"; null if not a myshopify domain.
export function normalizeShopDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const withSuffix = host.includes(".") ? host : `${host}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(withSuffix) ? withSuffix : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function descriptionHtml(description: string): string {
  return description
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Selling price: the product's price, else 2.5× cost, else none (set it in Shopify).
export function sellingPrice(p: ExportableProduct): string | undefined {
  const price = p.price ?? (p.cost ? p.cost * 2.5 : undefined);
  return price && price > 0 ? price.toFixed(2) : undefined;
}

export const productHandle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";

const cleanTags = (p: ExportableProduct) => [...new Set([...p.tags, p.category].map((t) => t.trim()).filter(Boolean))].slice(0, 20);

export function productSetInput(p: ExportableProduct) {
  const price = sellingPrice(p);
  return {
    title: p.title.slice(0, 255),
    descriptionHtml: descriptionHtml(p.description),
    productType: p.category,
    tags: cleanTags(p),
    status: "DRAFT",
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        ...(price ? { price } : {}),
        ...(p.cost ? { inventoryItem: { cost: p.cost.toFixed(2) } } : {}),
      },
    ],
    ...(/^https:\/\//.test(p.imageUrl) ? { files: [{ originalSource: p.imageUrl, contentType: "IMAGE", alt: p.title.slice(0, 200) }] } : {}),
  };
}

// Shopify product CSV (Products → Import in the Shopify admin).
const CSV_COLUMNS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Option1 Name", "Option1 Value",
  "Variant Price", "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Requires Shipping",
  "Cost per item", "Image Src", "Image Position", "Status",
];
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function productCsv(p: ExportableProduct): string {
  const row: Record<string, string> = {
    Handle: productHandle(p.title),
    Title: p.title,
    "Body (HTML)": descriptionHtml(p.description),
    Vendor: "",
    Type: p.category,
    Tags: cleanTags(p).join(", "),
    Published: "FALSE",
    "Option1 Name": "Title",
    "Option1 Value": "Default Title",
    "Variant Price": sellingPrice(p) ?? "",
    "Variant Inventory Policy": "deny",
    "Variant Fulfillment Service": "manual",
    "Variant Requires Shipping": "TRUE",
    "Cost per item": p.cost ? p.cost.toFixed(2) : "",
    "Image Src": /^https?:\/\//.test(p.imageUrl) ? p.imageUrl : "",
    "Image Position": /^https?:\/\//.test(p.imageUrl) ? "1" : "",
    Status: "draft",
  };
  return `${CSV_COLUMNS.join(",")}\n${CSV_COLUMNS.map((c) => csvCell(row[c])).join(",")}\n`;
}

// "advertiser name.mp4" → "advertiser-name-ad.mp4"
export const videoFileName = (advertiser: string) => `${productHandle(advertiser).slice(0, 40)}-ad.mp4`;
