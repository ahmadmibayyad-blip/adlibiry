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
        : /credit balance/i.test(error.message)
          ? "The AI is out of credit. The site owner needs to add credit at console.anthropic.com → Billing."
          : error instanceof Anthropic.NotFoundError
            ? "The AI model isn't available for this API key."
            : error instanceof Anthropic.PermissionDeniedError
              ? "This API key isn't allowed to use the AI model."
              : error instanceof Anthropic.InternalServerError || error.status === 529
                ? "The AI service is overloaded right now. Please try again in a minute."
                : "The AI had a problem. Please try again.";
  return isAdmin ? `${reason} (Anthropic ${error.status}: ${error.message.slice(0, 300)})` : reason;
}
