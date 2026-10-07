import * as z from "zod/v4";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashKey } from "./mcpKeys";
import { DATA_TOOLS } from "./lib/aiTools";

// ── MCP server ──────────────────────────────────────────────────────────────
// Lets customers use AdSpy Pro's ads and products from their own AI app
// (Claude, ChatGPT, Cursor…) over the Model Context Protocol, Streamable HTTP
// transport, stateless: every request is a POST of JSON-RPC and gets a JSON
// reply. Auth is a personal key from Settings, sent as
// "Authorization: Bearer <key>" or, for apps that only take a URL, "?key=<key>".

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "AdSpy Pro data: winning e-commerce products and running Facebook/Instagram/TikTok ads. " +
  "Use list_niches for valid niche names. Spend and revenue figures are estimates. " +
  "Products can be opened in the app at /dashboard/products/<id>.";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

const rpcError = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const TOOL_LIST = DATA_TOOLS.map((t) => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    inputSchema: schema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  };
});

export function readKey(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return new URL(request.url).searchParams.get("key")?.trim() || null;
}

async function handle(
  ctx: ActionCtx,
  msg: RpcRequest,
  keyId: Id<"mcpKeys">,
): Promise<RpcResponse | null> {
  const id = msg.id;
  // Notifications (no id) get no reply.
  if (id === undefined) return null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(id, -32600, "Invalid request");

  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "adspy-pro", title: "AdSpy Pro", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOL_LIST } };
    case "tools/call": {
      const name = msg.params?.name;
      const tool = DATA_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      const parsed = tool.inputSchema.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Invalid arguments: ${z.prettifyError(parsed.error)}` }], isError: true } };
      }
      const limit = Math.max(1, Number(process.env.MCP_DAILY_LIMIT ?? 300) || 300);
      const claim = await ctx.runMutation(internal.mcpKeys.claimToolCall, { keyId, limit });
      if (!claim.allowed) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Daily limit of ${limit} requests reached. It resets at midnight UTC.` }], isError: true } };
      }
      try {
        // Each tool's own schema validated the input above.
        const text = await (tool.run as (c: ActionCtx, input: unknown) => Promise<string>)(ctx, parsed.data);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
      } catch (e) {
        console.error("MCP tool failed", tool.name, e);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "The lookup failed. Please try again." }], isError: true } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export const mcpPost = httpAction(async (ctx, request) => {
  const key = readKey(request);
  const found = key ? await ctx.runQuery(internal.mcpKeys.findKey, { keyHash: await hashKey(key) }) : null;
  if (!found) {
    return json(rpcError(null, -32001, "Missing or invalid AdSpy Pro key. Create one in Settings → Connect your AI app or the API."), 401);
  }
  if (!found.paying) {
    return json(rpcError(null, -32003, "Connecting an AI app is part of the paid plans. It works again once your paid plan is active."), 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (messages.length === 0 || messages.length > 20) return json(rpcError(null, -32600, "Invalid request"), 400);

  const replies: RpcResponse[] = [];
  for (const m of messages) {
    const reply = await handle(ctx, m && typeof m === "object" ? m : {}, found.keyId);
    if (reply) replies.push(reply);
  }
  // Only notifications/responses were sent: acknowledge without a body.
  if (replies.length === 0) return new Response(null, { status: 202, headers: corsHeaders });
  return json(batch ? replies : replies[0]);
});

// Stateless server: no server-to-client stream and no sessions to end.
export const mcpNotAllowed = httpAction(async () =>
  new Response(JSON.stringify({ error: "Use POST" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS", ...corsHeaders },
  }),
);

export const mcpOptions = httpAction(async () => new Response(null, { status: 204, headers: corsHeaders }));
