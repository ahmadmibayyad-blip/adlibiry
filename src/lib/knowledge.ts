import data from "@/data/knowledge.json";
import { STAGES, type KContent, type KGuide, type KTopic } from "@/convex/lib/knowledge.ts";

// The Knowledge section's content and the pure parts of its pages: search,
// next guide and the break-even calculator. The built-in content is
// src/data/knowledge.json (12 topics, 33 guides, a glossary); once an admin
// saves edits (Admin → Knowledge) the saved copy in Convex is used instead,
// through useKnowledge(). Read progress is per user (convex/knowledge.ts).

export { STAGES };
export type Stage = (typeof STAGES)[number];
export type Level = KGuide["level"];
export type Guide = KGuide;
export type Topic = KTopic;
export type Content = KContent;

/** The guides that ship with the app. */
export const BUILT_IN: Content = data as Content;

export type Knowledge = ReturnType<typeof buildKnowledge>;

/** Everything the pages need from one copy of the content. */
export function buildKnowledge(c: Content) {
  const topics = c.topics;
  const allGuides = topics.flatMap((t) => t.guides.map((g) => ({ ...g, topic: t })));
  const glossary = c.glossary
    .filter((p): p is [string, string] => p.length === 2)
    .sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base" }));
  /** The guide after this one: the next in its topic, else the first of the next topic; null after the last. */
  const nextGuide = (topicId: string, guideId: string): { topic: Topic; guide: Guide } | null => {
    const i = allGuides.findIndex((g) => g.topic.id === topicId && g.id === guideId);
    const next = i >= 0 ? allGuides[i + 1] : undefined;
    return next ? { topic: next.topic, guide: next } : null;
  };
  return { reviewed: c.reviewed, topics, allGuides, glossary, nextGuide };
}

/** Whether a guide matches a search: every word appears in its title, summary, steps or tip. */
export function matches(g: Guide, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [g.title, g.summary, ...g.points, g.tip].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

export type CalcInput = {
  price: number; // selling price, VAT included
  vatPct: number;
  cost: number; // product cost
  shipping: number;
  duty: number;
  feePct: number; // payment fees, % of the selling price
  refundPct: number; // refund allowance, % of the selling price
};

// Reproduce the Unit economics guide's example: €39.95 in Denmark → net €31.96,
// break-even CPA €14.02, break-even ROAS 2.85, target ROAS 3.70.
export const CALC_DEFAULTS: CalcInput = { price: 39.95, vatPct: 25, cost: 9.95, shipping: 4.99, duty: 0, feePct: 2.5, refundPct: 5 };

/** Unit economics per the guide: net price, break-even CPA (contribution before ads), break-even and target ROAS. */
export function unitEconomics(i: CalcInput) {
  const net = i.price / (1 + i.vatPct / 100);
  const fees = (i.price * i.feePct) / 100;
  const refunds = (i.price * i.refundPct) / 100;
  const breakEvenCpa = net - i.cost - i.shipping - i.duty - fees - refunds;
  const breakEvenRoas = breakEvenCpa > 0 ? i.price / breakEvenCpa : null;
  return { net, fees, refunds, breakEvenCpa, breakEvenRoas, targetRoas: breakEvenRoas === null ? null : breakEvenRoas * 1.3 };
}
