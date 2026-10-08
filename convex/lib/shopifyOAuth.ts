// Shopify app install (OAuth) and webhook checks, as pure functions over Web
// Crypto so they run in Convex's default runtime and in tests.
// Docs: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant

// What Launch needs: create products (and their metafields), and put them on
// the Online Store when the user publishes them as active. Full store also
// installs our storefront theme (unpublished until the user makes it live)
// and creates its pages and menus.
export const STORE_SCOPES = ["write_themes", "write_online_store_pages", "write_online_store_navigation"] as const;
export const SHOPIFY_SCOPES =
  "write_products,read_products,write_publications,read_publications," +
  "write_themes,read_themes,write_online_store_pages,read_online_store_pages,write_online_store_navigation,read_online_store_navigation," +
  // "Ready to sell?" (storeCheck.ts) reads these; without them it asks to reconnect.
  "read_shipping,read_legal_policies";

/** Store scopes an app install is missing (a write scope implies its read scope). Unknown scopes (pasted tokens): none. */
export function missingStoreScopes(granted: string | undefined): string[] {
  if (granted === undefined) return [];
  const have = new Set(granted.split(",").map((s) => s.trim()));
  return STORE_SCOPES.filter((s) => !have.has(s));
}

const enc = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message)));
}
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Constant-time string compare (no early exit that leaks how much matched). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The install/callback query string is genuine: its `hmac` is the HMAC of the other parameters, sorted. */
export async function verifyQueryHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const given = params.get("hmac");
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, val]) => `${k}=${val}`)
    .join("&");
  return safeEqual(toHex(await hmac(secret, message)), given.toLowerCase());
}

/** A webhook is genuine: X-Shopify-Hmac-Sha256 is the base64 HMAC of the raw body. */
export async function verifyWebhookHmac(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  return safeEqual(toBase64(await hmac(secret, rawBody)), header.trim());
}

export function authorizeUrl(shop: string, clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, scope: SHOPIFY_SCOPES, redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

// ── access tokens encrypted at rest (AES-GCM, key in Convex env) ────────────

async function aesKey(keyB64: string) {
  const raw = fromBase64(keyB64);
  if (raw.length !== 32) throw new Error("SHOPIFY_TOKEN_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** "enc:v1:<base64(iv + ciphertext)>" */
export async function encryptToken(token: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(token)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `enc:v1:${toBase64(out)}`;
}

/** Decrypts an "enc:v1:" token; a plain (older, pasted) token comes back unchanged. */
export async function decryptToken(stored: string, keyB64: string | undefined): Promise<string> {
  if (!stored.startsWith("enc:v1:")) return stored;
  if (!keyB64) throw new Error("SHOPIFY_TOKEN_KEY isn't set, so the store's token can't be read");
  const bytes = fromBase64(stored.slice(7));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await aesKey(keyB64), bytes.slice(12));
  return new TextDecoder().decode(pt);
}
