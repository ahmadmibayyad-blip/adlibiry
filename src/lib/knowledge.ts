import data from "@/data/knowledge.json";

// The Knowledge section's content (src/data/knowledge.json: 12 topics, 33
// guides, a glossary), and the pure parts of its pages: search, next guide and
// the break-even calculator. Read progress is per user in Convex (convex/knowledge.ts).

export type Level = "Beginner" | "Intermediate" | "Advanced";
export type Guide = {
  id: string;
  title: string;
  level: Level;
  mins: number;
  summary: string;
  points: string[];
  mistakes: string[];
  tip: string;
  sources: { t: string; u: string }[];
};
export type Topic = { id: string; name: string; icon: string; stage: Stage; blurb: string; guides: Guide[] };
export const STAGES = ["Foundations", "Find", "Build", "Sell", "Grow"] as const;
export type Stage = (typeof STAGES)[number];

export const knowledge = data as { version: string; reviewed: string; topics: Topic[]; glossary: [string, string][] };
export const topics = knowledge.topics;
export const allGuides = topics.flatMap((t) => t.guides.map((g) => ({ ...g, topic: t })));
export const glossary = [...knowledge.glossary].sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base" }));

/** Whether a guide matches a search: every word appears in its title, summary, steps or tip. */
export function matches(g: Guide, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [g.title, g.summary, ...g.points, g.tip].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The guide after this one: the next in its topic, else the first of the next topic; null after the last. */
export function nextGuide(topicId: string, guideId: string): { topic: Topic; guide: Guide } | null {
  const i = allGuides.findIndex((g) => g.topic.id === topicId && g.id === guideId);
  const next = i >= 0 ? allGuides[i + 1] : undefined;
  return next ? { topic: next.topic, guide: next } : null;
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
