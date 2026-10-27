// App Bridge session tokens for Istilam's page inside Shopify admin: a JWT signed (HS256) with the
// app's client secret, naming the shop in `dest`. Checked on every request from the page.

import { safeEqual } from "./shopifyOAuth";

const SKEW_S = 5;
const SHOP_URL = /^https:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)$/;

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const b64urlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function json(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The shop the token was issued for, or null when it isn't a valid, current token for this app. */
export async function verifySessionToken(jwt: string, clientId: string, secret: string, now: number): Promise<{ shop: string } | null> {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[2]) return null;
  const header = json(parts[0]);
  const claims = json(parts[1]);
  if (header?.alg !== "HS256" || !claims) return null;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
  if (!safeEqual(b64urlEncode(sig), parts[2])) return null;

  const t = now / 1000;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp <= t - SKEW_S) return null;
  if (typeof claims.nbf === "number" && claims.nbf > t + SKEW_S) return null;
  const dest = typeof claims.dest === "string" ? claims.dest : "";
  const shop = SHOP_URL.exec(dest)?.[1];
  if (!shop || typeof claims.iss !== "string" || !claims.iss.startsWith(dest)) return null;
  return { shop };
}
