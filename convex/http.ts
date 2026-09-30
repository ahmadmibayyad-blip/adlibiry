import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { parseExtensionAd } from "./lib/extensionSubmission";
import { mcpNotAllowed, mcpOptions, mcpPost } from "./mcp";

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

    // Only identity fields are required. Many real ads have no headline
    // (video ads), no image yet (lazy-loaded) or no page URL. The rich fields
    // extension v2 scrapes (ad id, video, CTA, engagement, countries, start
    // date) are validated and kept — see convex/lib/extensionSubmission.ts.
    const parsed = parseExtensionAd(body);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      await ctx.runMutation(internal.submittedAds.submitFromExtension, parsed.submission);
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

// Apify calls this when an import run finishes. The ?run= token was created
// when we started the run (apifyRuns table), so only our own runs are accepted.
http.route({
  path: "/apify/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("run");
    if (!token) return new Response("Unauthorized", { status: 401 });
    let payload: any = null;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const run = await ctx.runQuery(internal.apify.getRunByToken, { token });
    if (!run) return new Response("Unknown run", { status: 401 });
    await ctx.scheduler.runAfter(0, internal.apify.handleWebhook, {
      token,
      datasetId: payload?.resource?.defaultDatasetId ? String(payload.resource.defaultDatasetId) : undefined,
      eventType: payload?.eventType ? String(payload.eventType) : undefined,
    });
    return new Response("queued", { status: 200 });
  }),
});

// MCP server: customers connect their own AI app (see convex/mcp.ts).
http.route({ path: "/mcp", method: "POST", handler: mcpPost });
http.route({ path: "/mcp", method: "GET", handler: mcpNotAllowed });
http.route({ path: "/mcp", method: "DELETE", handler: mcpNotAllowed });
http.route({ path: "/mcp", method: "OPTIONS", handler: mcpOptions });

export default http;
