"use node";

import Anthropic from "@anthropic-ai/sdk";

// One place to build the Claude client. ANTHROPIC_WORKSPACE_ID is only needed
// when the API key isn't scoped to a workspace (Anthropic then asks for the
// anthropic-workspace-id header on every request).
export function claudeClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
}
