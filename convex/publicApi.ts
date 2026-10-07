import * as z from "zod/v4";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { corsHeaders, readKey } from "./mcp";
import { hashKey } from "./mcpKeys";
import { listNichesTool, searchAdsTool, searchProductsTool } from "./lib/aiTools";

// ── Public REST API (roadmap P3-B) ──────────────────────────────────────────
// Plain GET endpoints over the same read-only tools as the MCP server, for
// scripts, sheets and agency dashboards:
//   GET /v1/products?category=Beauty&sort=score&limit=10
//   GET /v1/ads?niche=Pet%20Supplies&minDaysRunning=14
//   GET /v1/niches
// Same personal keys as MCP (Settings → Connect your AI app or the API), sent
// as "Authorization: Bearer <key>" or "?key=<key>", paid plans only, and the
// same daily cap (MCP_DAILY_LIMIT, shared between MCP and the API).

const ENDPOINTS = { products: searchProductsTool, ads: searchAdsTool, niches: listNichesTool } as const;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders, ...extra } });

/** Query-string values typed by the tool's schema: numbers and booleans are converted, the rest stay strings. */
export function queryToInput(schema: z.ZodObject, params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of params) {
    if (name === "key") continue;
    const field = schema.shape[name] as z.ZodType | undefined;
    const inner = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodType) : field;
    if (inner instanceof z.ZodNumber) out[name] = raw.trim() === "" ? Number.NaN : Number(raw);
    else if (inner instanceof z.ZodBoolean) out[name] = raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : raw;
    else out[name] = raw;
  }
  return out;
}

export const apiGet = httpAction(async (ctx, request) => {
  const name = new URL(request.url).pathname.replace(/^\/v1\//, "").replace(/\/+$/, "");
  const tool = ENDPOINTS[name as keyof typeof ENDPOINTS];
  if (!tool) return json({ error: `Unknown endpoint. Use one of: ${Object.keys(ENDPOINTS).map((e) => `/v1/${e}`).join(", ")}` }, 404);

  const key = readKey(request);
  const found = key ? await ctx.runQuery(internal.mcpKeys.findKey, { keyHash: await hashKey(key) }) : null;
  if (!found) return json({ error: "Missing or invalid AdSpy Pro key. Create one in Settings → Connect your AI app or the API." }, 401);
  if (!found.paying) return json({ error: "The API is part of the paid plans. It works again once your paid plan is active." }, 403);

  const parsed = tool.inputSchema.safeParse(queryToInput(tool.inputSchema, new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: `Invalid parameters: ${z.prettifyError(parsed.error)}` }, 400);

  const limit = Math.max(1, Number(process.env.MCP_DAILY_LIMIT ?? 300) || 300);
  const claim = await ctx.runMutation(internal.mcpKeys.claimToolCall, { keyId: found.keyId, limit });
  const rate = { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": String(Math.max(0, limit - claim.used)) };
  if (!claim.allowed) return json({ error: `Daily limit of ${limit} requests reached. It resets at midnight UTC.` }, 429, rate);

  try {
    // The tool's own schema validated the input above.
    const text = await (tool.run as (c: typeof ctx, input: unknown) => Promise<string>)(ctx, parsed.data);
    return json({ data: JSON.parse(text) as unknown }, 200, rate);
  } catch (e) {
    console.error("API request failed", name, e);
    return json({ error: "The lookup failed. Please try again." }, 500, rate);
  }
});
