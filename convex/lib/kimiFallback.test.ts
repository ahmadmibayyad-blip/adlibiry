import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { askKimi, shouldUseKimi, stripFence, toKimiRequest } from "./kimiFallback";
import Anthropic from "@anthropic-ai/sdk";
import { claudeClient } from "./claudeClient";
import { claudeErrorMessage } from "./claudeErrors";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Kimi fallback", () => {
  it("takes over for billing, overload, rate limits and outages, not for bad requests or tools", () => {
    expect(shouldUseKimi({ status: 400, message: "Your credit balance is too low to access the Anthropic API." }, {})).toBe(true);
    expect(shouldUseKimi({ status: 529, message: "Overloaded" }, {})).toBe(true);
    expect(shouldUseKimi({ status: 429, message: "rate_limit_error" }, {})).toBe(true);
    expect(shouldUseKimi({ status: 503, message: "x" }, {})).toBe(true);
    expect(shouldUseKimi({ message: "fetch failed" }, {})).toBe(true);
    expect(shouldUseKimi({ status: 400, message: "messages: field required" }, {})).toBe(false);
    expect(shouldUseKimi({ status: 401, message: "invalid x-api-key" }, {})).toBe(false);
    expect(shouldUseKimi({ status: 529, message: "Overloaded" }, { tools: [{}] })).toBe(false);
    expect(shouldUseKimi({ status: 529, message: "Overloaded" }, { stream: true })).toBe(false);
  });

  it("turns a Claude request into a Kimi one: system, images, JSON with the schema in the prompt", () => {
    const req = toKimiRequest({
      model: "claude-opus-5-5",
      max_tokens: 6000,
      system: [{ type: "text", text: "You write product pages." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Write it" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] }],
      output_config: { format: { type: "json_schema", schema: { type: "object", properties: { title: { type: "string" } } } } },
    });
    expect(req.model).toBe("kimi-k2.6");
    expect(req.max_completion_tokens).toBe(12000);
    expect(req.thinking).toEqual({ type: "disabled" });
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req.messages[0]).toMatchObject({ role: "system" });
    expect(req.messages[0].content).toContain("You write product pages.");
    expect(req.messages[0].content).toContain('"title"');
    expect(req.messages[1].content).toEqual([{ type: "text", text: "Write it" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
    expect(() => toKimiRequest({ messages: [{ role: "user", content: [{ type: "tool_result" }] }] })).toThrow(/can't send/);
  });

  it("answers like a Claude message, with the JSON parsed by the same schema", async () => {
    const bodies: { model: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "k1", model: "kimi-k2.6", choices: [{ message: { content: '```json\n{"title":"Hej"}\n```' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
    }));
    const schema = z.object({ title: z.string() });
    const msg = await askKimi(
      { model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "x" }], output_config: { format: zodOutputFormat(schema) } },
      { apiKey: "k", model: "kimi-k3" },
    );
    expect(bodies[0].model).toBe("kimi-k3");
    expect(msg).toMatchObject({ type: "message", stop_reason: "end_turn", parsed_output: { title: "Hej" }, usage: { input_tokens: 5, output_tokens: 3 } });
    expect(msg.content[0].text).toBe('{"title":"Hej"}');
    expect(stripFence("plain")).toBe("plain");
  });

  it("says so when Kimi's JSON answer is empty or cut off", async () => {
    const params = { messages: [{ role: "user" as const, content: "x" }], output_config: { format: zodOutputFormat(z.object({ title: z.string() })) } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }))));
    await expect(askKimi(params, { apiKey: "k" })).rejects.toThrow("Kimi's answer was empty (finish_reason length)");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"H' }, finish_reason: "length" }] }))));
    await expect(askKimi(params, { apiKey: "k" })).rejects.toThrow("cut off");
  });

  it("reports Kimi's own error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid Authentication" } }), { status: 401 })));
    await expect(askKimi({ messages: [{ role: "user", content: "x" }] }, { apiKey: "bad" })).rejects.toThrow("Kimi 401: Invalid Authentication");
  });

  it("claudeClient() answers with Kimi when Claude is out of credit, and only with a Kimi key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const hosts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      hosts.push(new URL(url).host);
      if (url.includes("anthropic.com")) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Fra Kimi"}' }, finish_reason: "stop" }] }));
    }));
    const params = { model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user" as const, content: "x" }], output_config: { format: zodOutputFormat(z.object({ title: z.string() })) } };
    await expect(claudeClient().messages.parse(params)).rejects.toThrow(/credit balance/);
    expect(hosts).not.toContain("api.moonshot.ai");

    vi.stubEnv("KIMI_API_KEY", "kimi-key");
    hosts.length = 0;
    const msg = await claudeClient().messages.parse(params);
    expect(msg.parsed_output).toEqual({ title: "Fra Kimi" });
    expect(hosts).toEqual(["api.anthropic.com", "api.moonshot.ai"]);
  });

  it("tries Kimi twice, and says when the backup failed too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("KIMI_API_KEY", "kimi-key");
    let kimiCalls = 0;
    let kimiOk = true;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
      if (String(u instanceof Request ? u.url : u).includes("anthropic.com")) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      kimiCalls++;
      if (kimiCalls === 1 || !kimiOk) return new Response(JSON.stringify({ error: { message: "Too many requests" } }), { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Fra Kimi"}' }, finish_reason: "stop" }] }));
    }));
    const params = { model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user" as const, content: "x" }], output_config: { format: zodOutputFormat(z.object({ title: z.string() })) } };
    const run = async () => {
      const p = claudeClient().messages.parse(params);
      const settled = p.then((v) => ({ v }), (e: unknown) => ({ e }));
      await vi.runAllTimersAsync();
      return settled;
    };
    expect(await run()).toMatchObject({ v: { parsed_output: { title: "Fra Kimi" } } });
    expect(kimiCalls).toBe(2);

    kimiOk = false;
    const failed = (await run()) as { e: InstanceType<typeof Anthropic.APIError> };
    expect(kimiCalls).toBe(4);
    expect(claudeErrorMessage(failed.e, false)).toBe(
      "The AI is out of credit. The site owner needs to add credit at console.anthropic.com → Billing. The backup AI couldn't answer either.",
    );
    expect(claudeErrorMessage(failed.e, true)).toContain("(Kimi: Kimi 429: Too many requests)");
    vi.useRealTimers();
  });
});
