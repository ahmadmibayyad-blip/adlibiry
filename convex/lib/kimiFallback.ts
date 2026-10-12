// Kimi (Moonshot AI) as a stand-in for Claude: when a Claude call fails because the
// account is out of credit, overloaded, rate limited or down, claudeClient() sends the
// same request to Kimi's OpenAI-compatible API and returns its answer shaped like a
// Claude message, so the AI features work unchanged. Only when KIMI_API_KEY is set;
// calls with tools or streaming stay on Claude. Pure helpers, plus one fetch.

export const KIMI_BASE_URL = "https://api.moonshot.ai/v1";
export const KIMI_DEFAULT_MODEL = "kimi-k2.6";

type Block = { type: string; text?: string; source?: { type: string; media_type?: string; data?: string; url?: string } };
type ClaudeParams = {
  model?: string;
  max_tokens?: number;
  system?: string | { type: string; text?: string }[];
  messages: { role: "user" | "assistant"; content: string | Block[] }[];
  tools?: unknown[];
  stream?: boolean;
  output_config?: { format?: { type?: string; schema?: unknown; parse?: (text: string) => unknown } };
};

type OpenAiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type KimiRequest = {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string | OpenAiPart[] }[];
  max_completion_tokens: number;
  response_format?: { type: "json_object" };
  thinking: { type: "disabled" };
};

/** Whether a failed Claude call should be retried on Kimi: billing, overload, rate limits and outages, not bad requests. */
export function shouldUseKimi(error: unknown, params: { tools?: unknown[]; stream?: boolean }): boolean {
  if (params.tools?.length || params.stream) return false;
  const e = error as { status?: number; message?: string } | null;
  const status = e?.status;
  const message = String(e?.message ?? "");
  if (/credit balance|billing|quota/i.test(message)) return true;
  if (status === 429 || status === 529 || (typeof status === "number" && status >= 500)) return true;
  // No response at all (network failure, timeout).
  return status === undefined && /fetch failed|timed? ?out|ECONNRESET|ENOTFOUND|network/i.test(message);
}

const systemText = (s: ClaudeParams["system"]) => (typeof s === "string" ? s : (s ?? []).map((b) => b.text ?? "").join("\n"));

/** A Claude request as a Kimi (OpenAI chat completions) request. Throws on content Kimi can't take. */
export function toKimiRequest(params: ClaudeParams, model = KIMI_DEFAULT_MODEL): KimiRequest {
  const format = params.output_config?.format;
  const wantsJson = format?.type === "json_schema";
  let system = systemText(params.system);
  if (wantsJson) {
    system +=
      (system ? "\n\n" : "") +
      "Answer with one JSON object only, no other text, that matches this JSON Schema exactly (every required field, the same field names):\n" +
      JSON.stringify(format?.schema ?? {});
  }
  const messages: KimiRequest["messages"] = system ? [{ role: "system", content: system }] : [];
  for (const m of params.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: OpenAiPart[] = m.content.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text ?? "" };
      if (b.type === "image" && b.source?.type === "base64") return { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
      if (b.type === "image" && b.source?.type === "url" && b.source.url) return { type: "image_url", image_url: { url: b.source.url } };
      throw new Error(`Kimi fallback can't send a "${b.type}" block`);
    });
    messages.push({ role: m.role, content: m.role === "assistant" ? parts.map((p) => (p.type === "text" ? p.text : "")).join("") : parts });
  }
  return {
    model,
    messages,
    // Kimi's Danish/German copy takes more tokens than Claude's, so leave room.
    max_completion_tokens: Math.max(8192, (params.max_tokens ?? 4096) * 2),
    ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
    // K2.6 thinks by default and spends the token budget on hidden reasoning, leaving the answer empty or cut off.
    thinking: { type: "disabled" },
  };
}

/** The JSON in a reply, without a ```json fence around it. */
export function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

type KimiResponse = {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Kimi's reply shaped like a Claude message (with parsed_output when the request asked for a JSON format). */
export function toClaudeMessage(res: KimiResponse, params: ClaudeParams) {
  const choice = res.choices?.[0];
  const format = params.output_config?.format;
  const raw = choice?.message?.content ?? "";
  const text = format?.type === "json_schema" ? stripFence(raw) : raw;
  if (format?.type === "json_schema" && (!text || choice?.finish_reason === "length")) {
    throw new Error(`Kimi's answer was ${text ? "cut off" : "empty"} (finish_reason ${choice?.finish_reason ?? "none"})`);
  }
  let parsed_output: unknown = null;
  if (format?.type === "json_schema") parsed_output = format.parse ? format.parse(text) : JSON.parse(text);
  return {
    id: res.id ?? "kimi",
    type: "message" as const,
    role: "assistant" as const,
    model: res.model ?? KIMI_DEFAULT_MODEL,
    content: [{ type: "text" as const, text, citations: null }],
    stop_reason: choice?.finish_reason === "length" ? ("max_tokens" as const) : ("end_turn" as const),
    stop_sequence: null,
    usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 },
    parsed_output,
  };
}

/** One request to Kimi. Throws with Kimi's status and message when it fails. */
export async function askKimi(params: ClaudeParams, env: { apiKey: string; model?: string; baseUrl?: string }) {
  const body = toKimiRequest(params, env.model || KIMI_DEFAULT_MODEL);
  const res = await fetch(`${env.baseUrl || KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json().catch(() => ({}))) as KimiResponse & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Kimi ${res.status}: ${json.error?.message ?? "request failed"}`);
  return toClaudeMessage(json, params);
}
