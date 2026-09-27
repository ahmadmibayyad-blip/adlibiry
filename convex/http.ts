import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth endpoints (sign-in, token refresh, JWKS).
auth.addHttpRoutes(http);

// Basic CORS so the Chrome extension (running on facebook.com/tiktok.com origins)
// can POST directly to this endpoint from its content/background script.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

http.route({
  path: "/extension/submit-ad",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

http.route({
  path: "/extension/submit-ad",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const b = (body ?? {}) as Record<string, unknown>;
    // Only identity fields are required. Many real ads have no headline
    // (video ads), no image yet (lazy-loaded) or no page URL — rejecting
    // those used to drop most submissions. Extra fields sent by extension
    // v2 (ad id, video, CTA, engagement...) are ignored here, not rejected.
    const required = ["visitorId", "advertiserName", "platform"];
    for (const field of required) {
      if (typeof b[field] !== "string" || (b[field] as string).trim().length === 0) {
        return new Response(JSON.stringify({ error: `Missing or invalid field: ${field}` }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    const bodyText = str(b.bodyText, 2000);
    const headline = str(b.headline, 500) || bodyText.split("\n")[0].slice(0, 200) || "Sponsored ad";
    const creativeUrl = str(b.creativeUrl, 2000) || str(b.advertiserAvatar, 2000);
    const landingPageUrl = str(b.landingPageUrl, 2000);
    const sourceUrl = str(b.sourceUrl, 2000) || str(b.adLibraryUrl, 2000) || str(b.pageUrl, 2000);

    if (!creativeUrl && !bodyText && headline === "Sponsored ad") {
      return new Response(JSON.stringify({ error: "Ad has no creative or text" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      await ctx.runMutation(internal.submittedAds.submitFromExtension, {
        submitterVisitorId: str(b.visitorId, 200),
        advertiserName: str(b.advertiserName, 200),
        platform: str(b.platform, 50),
        headline,
        bodyText,
        creativeUrl,
        landingPageUrl,
        sourceUrl,
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to record submission" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }),
});

export default http;
