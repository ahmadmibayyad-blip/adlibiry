/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const product = { title: "Dog cooling mat", description: "Gel mat", category: "Pet Supplies", price: 39.99 };

async function admin() {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "a1", role: "admin" }));
  return t.withIdentity({ subject: "a1|s" });
}

describe("AI tools explain failures instead of 'Server Error'", () => {
  it("says the AI isn't set up when there's no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const me = await admin();
    await expect(me.action(api.ai.scoreProduct, product)).rejects.toThrow(/aren't set up yet \(missing ANTHROPIC_API_KEY\)/);
  });

  it("passes on the API's reason, e.g. no credit", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const me = await admin();
    await expect(me.action(api.ai.scoreProduct, product)).rejects.toThrow(/out of credit/);
  });

  it("returns Claude's structured answer, clamped to the card's limits", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const answer = { score: 140, verdict: "Strong video product; cost unknown.", strengths: ["a", "b", "c", "d", "e"], risks: ["x"] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
            content: [{ type: "text", text: JSON.stringify(answer) }],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const me = await admin();
    const r = await me.action(api.ai.scoreProduct, product);
    expect(r).toMatchObject({ score: 100, verdict: "Strong video product; cost unknown." });
    expect(r.strengths).toHaveLength(4);
  });
});
