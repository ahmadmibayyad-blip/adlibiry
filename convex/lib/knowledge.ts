import { v, type Infer } from "convex/values";

// The Knowledge section's content shape, shared by the backend (admin edits in
// convex/knowledge.ts) and the pages (src/lib/knowledge.ts). The built-in
// content is src/data/knowledge.json; an admin's saved copy replaces it.

export const STAGES = ["Foundations", "Find", "Build", "Sell", "Grow"] as const;
export const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const guideValidator = v.object({
  id: v.string(),
  title: v.string(),
  level: v.union(...LEVELS.map((l) => v.literal(l))),
  mins: v.number(),
  summary: v.string(),
  points: v.array(v.string()),
  mistakes: v.array(v.string()),
  tip: v.string(),
  sources: v.array(v.object({ t: v.string(), u: v.string() })),
});

export const topicValidator = v.object({
  id: v.string(),
  name: v.string(),
  icon: v.string(),
  stage: v.union(...STAGES.map((s) => v.literal(s))),
  blurb: v.string(),
  guides: v.array(guideValidator),
});

export const contentFields = {
  reviewed: v.string(),
  topics: v.array(topicValidator),
  glossary: v.array(v.array(v.string())),
};

export type KGuide = Infer<typeof guideValidator>;
export type KTopic = Infer<typeof topicValidator>;
export type KContent = { reviewed: string; topics: KTopic[]; glossary: string[][] };

const MAX_TEXT = 2000;

/** What's wrong with an edited copy of the content, as plain sentences ([] when it can be saved). */
export function contentProblems(c: KContent): string[] {
  const out: string[] = [];
  const text = (s: string, what: string, required = true) => {
    if (required && !s.trim()) out.push(`${what} is empty.`);
    else if (s.length > MAX_TEXT) out.push(`${what} is longer than ${MAX_TEXT} characters.`);
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.reviewed)) out.push("The review date must look like 2026-10-09.");
  if (!c.topics.length) out.push("Add at least one topic.");
  if (c.topics.length > 40) out.push("Keep it to 40 topics or fewer.");
  const topicIds = new Set<string>();
  const guideIds = new Set<string>();
  for (const t of c.topics) {
    const name = `Topic "${t.name || t.id}"`;
    if (!SLUG.test(t.id)) out.push(`${name} has an invalid id (use lowercase letters, numbers and dashes).`);
    else if (topicIds.has(t.id)) out.push(`Two topics share the id "${t.id}".`);
    topicIds.add(t.id);
    text(t.name, `${name}'s name`);
    text(t.blurb, `${name}'s description`);
    if (!t.guides.length) out.push(`${name} has no guides; add one or delete the topic.`);
    if (t.guides.length > 40) out.push(`${name} has more than 40 guides.`);
    for (const g of t.guides) {
      const gname = `Guide "${g.title || g.id}"`;
      if (!SLUG.test(g.id)) out.push(`${gname} has an invalid id.`);
      else if (guideIds.has(g.id)) out.push(`Two guides share the id "${g.id}".`);
      guideIds.add(g.id);
      text(g.title, `${gname}'s title`);
      text(g.summary, `${gname}'s summary`);
      text(g.tip, `${gname}'s pro tip`, false);
      if (!Number.isInteger(g.mins) || g.mins < 1 || g.mins > 120) out.push(`${gname}'s read time must be 1 to 120 minutes.`);
      if (!g.points.length) out.push(`${gname} needs at least one key step.`);
      if (g.points.length > 30 || g.mistakes.length > 30 || g.sources.length > 20) out.push(`${gname} has too many steps, mistakes or sources.`);
      g.points.forEach((p, i) => text(p, `${gname}'s step ${i + 1}`));
      g.mistakes.forEach((m, i) => text(m, `${gname}'s mistake ${i + 1}`));
      for (const s of g.sources) {
        text(s.t, `${gname}'s source title`);
        if (!/^https?:\/\/[^\s]+$/.test(s.u)) out.push(`${gname} has a source link that isn't a web address: "${s.u}".`);
      }
    }
  }
  if (c.glossary.length > 300) out.push("Keep the glossary to 300 terms or fewer.");
  const terms = new Set<string>();
  c.glossary.forEach((pair, i) => {
    if (pair.length !== 2) return out.push(`Glossary entry ${i + 1} needs a term and a meaning.`);
    const [term, def] = pair;
    text(term, `Glossary term ${i + 1}`);
    text(def, `The meaning of "${term || `term ${i + 1}`}"`);
    if (terms.has(term.trim().toLowerCase())) out.push(`The glossary has "${term}" twice.`);
    terms.add(term.trim().toLowerCase());
  });
  return out;
}
