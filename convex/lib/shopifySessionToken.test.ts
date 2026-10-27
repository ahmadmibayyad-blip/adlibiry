import { describe, expect, it } from "vitest";
import { verifySessionToken } from "./shopifySessionToken";

const CLIENT_ID = "istilam-client";
const SECRET = "istilam-secret";
const NOW = Date.UTC(2026, 9, 27, 12);
const SHOP = "istilam-dev.myshopify.com";

const b64url = (s: string | Uint8Array) =>
  btoa(typeof s === "string" ? s : String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }, secret = SECRET) {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(head)));
  return `${head}.${b64url(sig)}`;
}

const claims = (over: Record<string, unknown> = {}) => ({
  iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: CLIENT_ID, sub: "42",
  exp: NOW / 1000 + 60, nbf: NOW / 1000 - 5, iat: NOW / 1000 - 5, jti: "j", sid: "s", ...over,
});

describe("verifySessionToken", () => {
  it("returns the shop of a valid token", async () => {
    expect(await verifySessionToken(await sign(claims()), CLIENT_ID, SECRET, NOW)).toEqual({ shop: SHOP });
  });
  it("refuses another app's, expired, tampered and unsigned tokens", async () => {
    expect(await verifySessionToken(await sign(claims({ aud: "other" })), CLIENT_ID, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken(await sign(claims({ exp: NOW / 1000 - 10 })), CLIENT_ID, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken(await sign(claims({ nbf: NOW / 1000 + 60 })), CLIENT_ID, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken(await sign(claims(), undefined, "wrong"), CLIENT_ID, SECRET, NOW)).toBeNull();
    const good = await sign(claims());
    const [h, , s] = good.split(".");
    const forged = `${h}.${b64url(JSON.stringify(claims({ dest: "https://other.myshopify.com" })))}.${s}`;
    expect(await verifySessionToken(forged, CLIENT_ID, SECRET, NOW)).toBeNull();
    const none = `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims()))}.`;
    expect(await verifySessionToken(none, CLIENT_ID, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken("garbage", CLIENT_ID, SECRET, NOW)).toBeNull();
  });
  it("refuses a dest that isn't a myshopify shop or doesn't match iss", async () => {
    expect(await verifySessionToken(await sign(claims({ dest: "https://evil.com", iss: "https://evil.com/admin" })), CLIENT_ID, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken(await sign(claims({ iss: "https://other.myshopify.com/admin" })), CLIENT_ID, SECRET, NOW)).toBeNull();
  });
});
