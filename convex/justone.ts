import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// JustOne API (api.justoneapi.com): one token for TikTok Shop, AliExpress, Amazon, 1688, TikTok and more, billed per
// successful call. The token is JUSTONE_API_KEY (justone_api_key also works). `probe` is for trying endpoints from the
// Convex dashboard (Functions → justone:probe) before a feature uses them.

const BASE = "https://api.justoneapi.com";

const ERRORS: Record<number, string> = {
  100: "the token is wrong or switched off",
  301: "JustOne couldn't collect it, try again",
  302: "too many requests",
  303: "the daily quota is used up",
  400: "bad parameters",
  600: "this token can't use that endpoint",
  601: "the JustOne balance is empty",
  602: "this token's budget is used up",
};

export function justoneToken(): string | undefined {
  return (process.env.JUSTONE_API_KEY ?? process.env.justone_api_key)?.trim() || undefined;
}

/** GET a JustOne endpoint and return its `data`; throws a short message for any non-zero code. */
export async function justoneGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const token = justoneToken();
  if (!token) throw new Error("JUSTONE_API_KEY isn't set");
  const q = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) if (val !== undefined && val !== "") q.set(k, String(val));
  q.set("token", token);
  const res = await fetch(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let body: { code?: number; message?: string; data?: unknown } | null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`JustOne answered ${res.status}: ${text.slice(0, 200)}`);
  }
  if (body?.code !== 0) throw new Error(`JustOne ${body?.code}: ${ERRORS[body?.code ?? -1] ?? body?.message ?? "failed"}`);
  return body.data;
}

/** Cuts long arrays and strings so a dashboard run shows the shape of an answer. */
function sample(x: unknown, depth = 0): unknown {
  if (typeof x === "string") return x.length > 300 ? `${x.slice(0, 300)}…` : x;
  if (Array.isArray(x)) {
    const head = x.slice(0, depth === 0 ? 5 : 3).map((y) => sample(y, depth + 1));
    return x.length > head.length ? [...head, `…${x.length} items`] : head;
  }
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, sample(y, depth + 1)]));
  return x;
}

export const probe = internalAction({
  args: { path: v.string(), params: v.optional(v.any()), full: v.optional(v.boolean()) },
  handler: async (_ctx, args) => {
    const data = await justoneGet(args.path, (args.params ?? {}) as Record<string, string>);
    return args.full ? data : sample(data);
  },
});
