// Vercel function: opens a page in headless Chrome and returns the HTML after its scripts have run
// (and, if asked, the readable text as Markdown). Convex calls it when a plain fetch comes back
// blocked or as an empty JavaScript shell (convex/lib/pageFetch.ts fetchPage).
//
// POST {"url": "https://...", "markdown"?: true} with "Authorization: Bearer <RENDER_SECRET>".
// Answers {"url", "status", "html", "markdown"?} or {"error"}.
//
// Self-contained on purpose (see api/landing.ts): no relative imports.

import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const MAX_HTML = 3_000_000;
// What a page needs to build itself; photos, video and fonts only cost time.
const SKIPPED = new Set(["image", "media", "font"]);

/** Whether an IP address is on the public internet (not this machine, a private network or link-local). */
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    // An IPv4 address written as IPv6 (::ffff:127.0.0.1, which URLs turn into ::ffff:7f00:1).
    const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPublicIp(dotted[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPublicIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return !(s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff"));
  }
  return false;
}

/** A link we're willing to open: http(s) on the default ports, to a name or a public IP. */
export function safeUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.port || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return isPublicIp(host) ? u : null;
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return null;
  return u;
}

/** The link, if its name points only at public addresses (stops a link that resolves to a private network). */
async function resolvesPublic(u: URL): Promise<boolean> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicIp(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
  } catch {
    return false;
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.RENDER_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Runs inside the page: its main text as Markdown (headings, paragraphs, lists, links, images, tables).
function pageMarkdown(): string {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "TEMPLATE", "NAV", "FOOTER", "FORM", "BUTTON", "SELECT"]);
  // Pages often carry hidden copies (phone and desktop versions of a block): only what is shown counts.
  const hidden = (el: HTMLElement) =>
    skip.has(el.tagName) || el.getAttribute("aria-hidden") === "true" || !el.checkVisibility({ visibilityProperty: true });
  const root = document.querySelector("main") ?? document.body;
  const clean = (s: string) => s.replace(/\s+/g, " ");
  const abs = (s: string | null) => {
    try {
      return s ? new URL(s, location.href).href : "";
    } catch {
      return "";
    }
  };
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return clean(n.textContent ?? "");
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const el = n as HTMLElement;
    if (hidden(el)) return "";
    const inner = () => Array.from(el.childNodes).map(inline).join("");
    switch (el.tagName) {
      case "BR":
        return "\n";
      case "IMG": {
        const src = abs(el.getAttribute("src"));
        return src && !src.startsWith("data:") ? `![${clean(el.getAttribute("alt") ?? "")}](${src})` : "";
      }
      case "A": {
        const text = inner().trim();
        const href = abs(el.getAttribute("href"));
        return text && href && !href.startsWith("javascript:") ? `[${text}](${href})` : text;
      }
      case "STRONG":
      case "B": {
        const t = inner().trim();
        return t ? `**${t}**` : "";
      }
      case "EM":
      case "I": {
        const t = inner().trim();
        return t ? `*${t}*` : "";
      }
      default:
        return inner();
    }
  };
  const out: string[] = [];
  const block = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = clean(n.textContent ?? "").trim();
      if (t) out.push(t);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (hidden(el)) return;
    const h = el.tagName.match(/^H([1-6])$/);
    if (h) {
      const t = inline(el).trim();
      if (t) out.push(`${"#".repeat(Number(h[1]))} ${t}`);
    } else if (el.tagName === "P" || el.tagName === "BLOCKQUOTE") {
      const t = inline(el).trim();
      if (t) out.push(el.tagName === "P" ? t : `> ${t}`);
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      const items = Array.from(el.children)
        .filter((c) => c.tagName === "LI")
        .map((li, i) => `${el.tagName === "OL" ? `${i + 1}.` : "-"} ${inline(li).trim()}`)
        .filter((s) => s.length > 2);
      if (items.length) out.push(items.join("\n"));
    } else if (el.tagName === "TABLE") {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, "\\|")));
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        out.push([line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
      }
    } else if (el.tagName === "IMG" || el.tagName === "A") {
      const t = inline(el).trim();
      if (t) out.push(t);
    } else {
      el.childNodes.forEach(block);
    }
  };
  block(root);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function openBrowser(): Promise<Browser> {
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1366, height: 900 },
  });
}

/** Loads the page and waits for it to settle; the main document's HTTP status. */
async function load(page: Page, u: URL): Promise<number> {
  // A real browser, so it can say so: Chrome's name without "Headless".
  await page.setUserAgent((await page.browser().userAgent()).replace("HeadlessChrome", "Chrome"));
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.isInterceptResolutionHandled()) return;
    const target = safeUrl(req.url());
    const data = /^(data|blob):/.test(req.url());
    if (SKIPPED.has(req.resourceType()) || (!target && !data)) void req.abort();
    else void req.continue();
  });
  const res = await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 });
  // Let scripts fetch what they show; a page that never goes quiet is read as it is after 8 seconds.
  await page.waitForNetworkIdle({ idleTime: 700, timeout: 8_000 }).catch(() => {});
  // Cloudflare's "Just a moment..." check passes on its own in a real browser, then reloads the page.
  if (/just a moment|checking your browser/i.test(await page.title())) {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 5_000 }).catch(() => {});
  }
  return res?.status() ?? 0;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => null)) as { url?: unknown; markdown?: unknown } | null;
  const u = safeUrl(body?.url);
  if (!u || !(await resolvesPublic(u))) return json({ error: "bad url" }, 400);

  let browser: Browser | null = null;
  try {
    browser = await openBrowser();
    const page = await browser.newPage();
    const status = await load(page, u);
    const html = (await page.content()).slice(0, MAX_HTML);
    const markdown = body?.markdown === true ? await page.evaluate(pageMarkdown) : undefined;
    return json({ url: page.url(), status, html, markdown });
  } catch (e) {
    console.warn("render failed", u.host, e);
    return json({ error: "render failed" }, 502);
  } finally {
    await browser?.close().catch(() => {});
  }
}
