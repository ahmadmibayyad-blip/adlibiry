// Screenshot to page: a screenshot of a landing or product page becomes one HTML file with Tailwind
// (screenPagesAi.ts asks Claude; screenPages.ts keeps the pages). The prompts and the checks on the answer. Pure.

export const MAX_NOTES = 1000;
export const MAX_HTML = 400_000;

/** Pages made or changed per day, by tier (lib/billing.ts byTier): each is one large AI answer. */
export const SCREEN_PAGE_RUNS = { admin: 200, paid: 30, trial: 5, free: 2 } as const;

export const SCREEN_PAGE_SYSTEM = `You are an expert front-end developer. You turn screenshots of web pages into one complete HTML file that looks exactly like the screenshot.

- Use Tailwind CSS from <script src="https://cdn.tailwindcss.com"></script>. Load fonts that look like the screenshot's from Google Fonts with a <link>.
- Match the screenshot closely: layout, spacing, colors (exact hex, e.g. bg-[#f4efe9]), font sizes and weights, borders, corners and shadows.
- Use the exact text from the screenshot. Write out every repeated item in full: never leave comments like "<!-- more items here -->".
- For photos, use https://placehold.co/WIDTHxHEIGHT/EEEEEE/999999?text=Short+description with the size they have in the screenshot. Draw icons and logos as inline SVG.
- Make it responsive: it must also look right on a phone.
- Make every menu item, button and icon that would open something (shop, buy, cart, search, account, logo) an <a href="#"> element: they are linked to the store later. Small plain JavaScript is fine for what the screenshot shows (menus, tabs, accordions, sliders); no other scripts or frameworks.
- Reply with only the HTML document, from <!DOCTYPE html> to </html>, without explanations.`;

/** Products the page shows instead of the screenshot's, at most this many. */
export const MAX_PAGE_PRODUCTS = 6;

export type PageProduct = { title: string; url: string; images: string[]; price?: { amount: number; currency: string } };

/** The products for the AI: what to show and where their buttons go. */
export function productsBrief(products: PageProduct[]): string {
  if (!products.length) return "";
  const lines = products.slice(0, MAX_PAGE_PRODUCTS).map((p, i) =>
    [
      `${i + 1}. ${p.title}`,
      p.price ? `price ${p.price.amount.toFixed(2)} ${p.price.currency}` : "",
      p.images.length ? `photos: ${p.images.slice(0, 4).join(" ")}` : "",
      `link: ${p.url}`,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  return [
    products.length > 1
      ? "Show these products instead of the screenshot's, in this order (the first is the main one where the page has one product):"
      : "The page sells this product instead of the screenshot's:",
    ...lines,
    "Use their names and prices (written the way the page's language writes prices; leave a price out when none is given), their photos instead of " +
      "placeholders, and their link for every buy, shop and product button and for the product card. Keep the screenshot's layout and style.",
  ].join("\n");
}

export function createPrompt(partsNote: string, notes?: string, products: PageProduct[] = []): string {
  return [
    "Build this page as one HTML file.",
    partsNote,
    productsBrief(products),
    notes?.trim() ? `The user's notes (follow them): ${notes.trim().slice(0, MAX_NOTES)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function editPrompt(html: string, change: string, partsNote: string): string {
  return [
    "This is the page you built from the screenshot:",
    html,
    partsNote ? `(${partsNote})` : "",
    `Change it as the user asks and keep everything else the same: ${change.trim().slice(0, MAX_NOTES)}`,
    "Reply with the whole updated HTML document.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The HTML document in the AI's answer (with or without a code fence), or null when there is none. */
export function extractHtml(answer: string): string | null {
  const text = answer.replace(/```(?:html)?/gi, "");
  const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf("</html>");
  let html: string;
  if (start >= 0 && end > start) html = text.slice(start, end + "</html>".length);
  else if (start >= 0) html = `${text.slice(start).trim()}\n</body>\n</html>`; // cut off at the token limit: close it
  else if (/<body[\s>]/i.test(text)) html = `<!DOCTYPE html>\n<html>\n${text.trim()}\n</html>`;
  else return null;
  html = html.trim();
  return html.length >= 200 && html.length <= MAX_HTML ? html : null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A name for the page: its <title>, else its first heading. */
export function pageTitle(html: string): string {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const h1 = decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  return (title || h1 || "Untitled page").slice(0, 80);
}

