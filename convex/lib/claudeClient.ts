"use node";

import Anthropic from "@anthropic-ai/sdk";
import { askKimi, shouldUseKimi } from "./kimiFallback";

// One place to build the Claude client. ANTHROPIC_WORKSPACE_ID is only needed
// when the API key isn't scoped to a workspace (Anthropic then asks for the
// anthropic-workspace-id header on every request).
//
// With KIMI_API_KEY set, a call that fails for billing, overload, rate limits or
// an outage is answered by Kimi instead (lib/kimiFallback.ts); KIMI_MODEL picks
// the model. If Kimi fails too, the caller gets Claude's error as before.
export function claudeClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  const kimiKey = process.env.KIMI_API_KEY?.trim();
  if (!kimiKey) return client;
  const kimi = { apiKey: kimiKey, model: process.env.KIMI_MODEL?.trim() };

  const withFallback = <F extends (params: never, options?: never) => unknown>(call: F): F =>
    (async (params: Parameters<F>[0], options?: Parameters<F>[1]) => {
      try {
        return await call(params, options);
      } catch (error) {
        // messages.parse calls messages.create: an error create already took to Kimi isn't tried again.
        if ((error as { kimiError?: string } | null)?.kimiError !== undefined) throw error;
        if (!shouldUseKimi(error, params as { tools?: unknown[]; stream?: boolean })) throw error;
        console.warn("Claude failed, answering with Kimi:", (error as Error).message?.slice(0, 200));
        // Twice: Kimi's own rate limits and an answer that's cut off or doesn't fit the schema are often one-offs.
        let last: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await askKimi(params as Parameters<typeof askKimi>[0], kimi);
          } catch (kimiError) {
            last = kimiError;
            console.error(`Kimi fallback failed (try ${attempt + 1}):`, (kimiError as Error).message?.slice(0, 300));
            if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
          }
        }
        // Claude's error stays the one callers see; claudeErrorMessage says the backup failed too.
        if (error && typeof error === "object") (error as { kimiError?: string }).kimiError = String((last as Error)?.message ?? last).slice(0, 300);
        throw error;
      }
    }) as unknown as F;

  client.messages.create = withFallback(client.messages.create.bind(client.messages)) as typeof client.messages.create;
  client.messages.parse = withFallback(client.messages.parse.bind(client.messages)) as typeof client.messages.parse;
  return client;
}
