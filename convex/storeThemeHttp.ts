import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { themeFiles, themeSecret, themeSignatureOk, type StoreCopy, type StoreFacts } from "./lib/storeKit";
import { zipFiles } from "./lib/zip";

// GET /launch/ad-image?id=<storageId>&s=<signature>: an ad image (launchAds.ts), with CORS so the
// app can draw the ad's text on it in a canvas and download the result.
export const serveAdImage = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const secret = themeSecret();
  if (!secret || !id || !(await themeSignatureOk(`ad-image:${id}`, url.searchParams.get("s") ?? "", secret))) return new Response("Not found", { status: 404 });
  const blob = await ctx.storage.get(id as Id<"_storage">).catch(() => null);
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(blob, {
    status: 200,
    headers: { "Content-Type": blob.type || "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=31536000, immutable" },
  });
});

// GET /shopify/theme.zip?l=<launchId>&s=<signature>: the storefront theme of a
// Full store launch, with its style, copy and menus. Shopify's themeCreate
// downloads it (launchRun.ts). Signed so launch ids can't be enumerated.

export const serveTheme = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const launchId = url.searchParams.get("l") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  const secret = themeSecret();
  if (!secret || !launchId || !(await themeSignatureOk(launchId, sig, secret))) return new Response("Not found", { status: 404 });
  const src = await ctx.runQuery(internal.launch.themeSource, { launchId: launchId as Id<"launches"> }).catch(() => null);
  if (!src) return new Response("Not found", { status: 404 });
  const zip = zipFiles(
    themeFiles({
      style: src.style,
      brandName: src.brandName,
      productHandle: src.productHandle,
      pageHandles: src.pageHandles,
      copy: src.store as StoreCopy,
      product: { title: src.title },
      facts: src.facts as StoreFacts,
    }),
  );
  return new Response(zip.buffer as ArrayBuffer, {
    status: 200,
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="adspy-storefront.zip"', "Cache-Control": "no-store" },
  });
});
