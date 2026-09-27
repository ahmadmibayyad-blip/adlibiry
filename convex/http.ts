import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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

    const b = body as Record<string, unknown>;
    const required = ["visitorId", "advertiserName", "platform", "headline", "creativeUrl", "sourceUrl"];
    for (const field of required) {
      if (typeof b[field] !== "string" || (b[field] as string).length === 0) {
        return new Response(JSON.stringify({ error: `Missing or invalid field: ${field}` }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    try {
      await ctx.runMutation(internal.submittedAds.submitFromExtension, {
        submitterVisitorId: String(b.visitorId).slice(0, 200),
        advertiserName: String(b.advertiserName).slice(0, 200),
        platform: String(b.platform).slice(0, 50),
        headline: String(b.headline).slice(0, 500),
        bodyText: typeof b.bodyText === "string" ? b.bodyText.slice(0, 2000) : "",
        creativeUrl: String(b.creativeUrl).slice(0, 2000),
        landingPageUrl: typeof b.landingPageUrl === "string" ? b.landingPageUrl.slice(0, 2000) : "",
        sourceUrl: String(b.sourceUrl).slice(0, 2000),
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
