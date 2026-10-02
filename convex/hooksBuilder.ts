"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { claudeClient } from "./lib/claudeClient";
import { NICHES } from "./lib/category";
import { HOOK_TYPES, isoWeek } from "./lib/hooks";

// Weekly Hooks of the week build (Mondays, convex/crons.ts). One Claude call
// per niche labels the hooks; without an API key or on an error the hooks are
// still saved, just without the labels.

const Analysis = z.object({
  hooks: z.array(
    z.object({
      index: z.number().int(),
      type: z.string(),
      why: z.string(),
      template: z.string(),
    }),
  ),
});

const SYSTEM = `You analyse the opening lines ("hooks") of winning e-commerce ads for dropshippers.
For each numbered hook give:
- type: one of ${HOOK_TYPES.join(", ")}
- why: one short sentence on why it stops the scroll
- template: a reusable fill-in-the-blank version with [brackets], e.g. "POV: you finally found a [product] that [result]"
Keep the hook's language. Plain words, no emojis.`;

type Candidate = { adId: string; hook: string; score: number };
type Labels = { type?: string; why?: string; template?: string };

async function analyse(client: Anthropic, niche: string, hooks: Candidate[]): Promise<Labels[]> {
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 3000,
    output_config: { effort: "low", format: zodOutputFormat(Analysis) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Niche: ${niche}\n\n${hooks.map((h, i) => `${i + 1}. ${h.hook}`).join("\n")}` }],
  });
  const out: Labels[] = hooks.map(() => ({}));
  for (const h of response.parsed_output?.hooks ?? []) {
    const i = h.index - 1;
    if (i < 0 || i >= hooks.length) continue;
    out[i] = {
      type: (HOOK_TYPES as readonly string[]).includes(h.type) ? h.type : "Other",
      why: h.why.slice(0, 300),
      template: h.template.slice(0, 300),
    };
  }
  return out;
}

async function build(ctx: ActionCtx) {
  const week = isoWeek(Date.now());
  const client = process.env.ANTHROPIC_API_KEY ? claudeClient() : null;
  const result = { week, niches: 0, hooks: 0, analysed: 0, errors: [] as string[] };
  for (const niche of NICHES) {
    const hooks = (await ctx.runQuery(internal.hooks.candidates, { niche })) as Candidate[];
    if (!hooks.length) continue;
    let labels: Labels[] = hooks.map(() => ({}));
    if (client) {
      try {
        labels = await analyse(client, niche, hooks);
        result.analysed += labels.filter((l) => l.type).length;
      } catch (e) {
        result.errors.push(`${niche}: ${e instanceof Error ? e.message.slice(0, 200) : "AI error"}`);
      }
    }
    await ctx.runMutation(internal.hooks.saveNiche, {
      week,
      niche,
      rows: hooks.map((h, i) => ({ adId: h.adId as Id<"ads">, hook: h.hook, score: h.score, ...labels[i] })),
    });
    result.niches++;
    result.hooks += hooks.length;
  }
  console.log("Hooks of the week", JSON.stringify(result));
  return result;
}

export const buildWeekly = internalAction({ args: {}, handler: async (ctx) => await build(ctx) });

// Admin "Build now" on the Hooks page (the first list, or a refresh).
export const buildNow = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.hooks.assertAdmin, {});
    return await build(ctx);
  },
});
