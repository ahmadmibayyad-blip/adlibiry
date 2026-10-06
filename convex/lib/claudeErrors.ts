"use node";

import Anthropic from "@anthropic-ai/sdk";

// A customer-facing reason for a failed Claude API call, shared by the AI
// features. Admins also get Anthropic's own message to fix the setup.
export function claudeErrorMessage(error: InstanceType<typeof Anthropic.APIError>, isAdmin: boolean): string {
  const reason =
    error instanceof Anthropic.AuthenticationError
      ? "The AI API key is invalid."
      : error instanceof Anthropic.RateLimitError
        ? "The AI is busy right now. Try again in a minute."
        : /not scoped to a workspace/i.test(error.message)
          ? "The AI API key isn't linked to a workspace. The site owner needs a workspace API key, or to set ANTHROPIC_WORKSPACE_ID."
        : /credit balance/i.test(error.message)
          ? "The AI is out of credit. The site owner needs to add credit at console.anthropic.com → Billing."
          : error instanceof Anthropic.NotFoundError
            ? "The AI model isn't available for this API key."
            : error instanceof Anthropic.PermissionDeniedError
              ? "This API key isn't allowed to use the AI model."
              : error instanceof Anthropic.InternalServerError || error.status === 529
                ? "The AI service is overloaded right now. Please try again in a minute."
                : "The AI had a problem. Please try again.";
  return isAdmin ? `${reason} (Anthropic ${error.status}: ${error.message.slice(0, 300)}) [${setupHint()}]` : reason;
}

// Admin-only: which key and workspace this deployment actually loaded, so a
// value set on the wrong Convex deployment (dev vs prod) is easy to spot.
// Shows only the last 4 characters of each.
function setupHint(): string {
  const tail = (v?: string) => (v?.trim() ? `…${v.trim().slice(-4)}` : "not set");
  return `server key ${tail(process.env.ANTHROPIC_API_KEY)}, ANTHROPIC_WORKSPACE_ID ${tail(process.env.ANTHROPIC_WORKSPACE_ID)}`;
}
