import { ConvexError } from "convex/values";

// The readable reason from a failed Convex call: a ConvexError's message (the
// server's own words), else a fallback instead of "Server Error" noise.
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const message = (error.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
