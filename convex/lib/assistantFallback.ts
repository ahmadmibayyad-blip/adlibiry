// Ask AI without tools: when Claude can't answer (out of credit, overloaded, down),
// Kimi answers instead, but Kimi gets no tools (lib/kimiFallback.ts). So the app
// looks the data up first, from the customer's last message, and hands it over
// in the system prompt. Pure helpers; assistant.ts runs the lookups.

const STOP = new Set(
  ("a an and are as at be best by can do find for from get give good great have how i in is it me my of on or show " +
    "some that the their them these this to top under up what which who why will with write you your " +
    "winning winners winner product products ad ads running longest margin margins high low most more " +
    "one two three four five six seven eight nine ten should start beginner").split(" "),
);

/** Up to 5 meaningful words from the message, for the product and ad text search. */
export function searchWords(message: string): string {
  const words = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, 5).join(" ");
}

/** Niches the message names ("pet" matches "Pets", "beauty" matches "Beauty"). */
export function matchNiches(message: string, niches: string[]): string[] {
  const words = new Set(message.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  const stem = (w: string) => w.replace(/(ies|es|s)$/, "");
  const stems = new Set([...words].map(stem));
  return niches.filter((n) =>
    n
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 2)
      .some((w) => words.has(w) || stems.has(stem(w))),
  );
}

/** Whether the question is about stores, so store data is worth looking up. */
export const asksAboutStores = (message: string) => /\b(stores?|shops?|shopify|theme|klaviyo|pixel|competitors?)\b/i.test(message);

/** The assistant's system prompt for an answer without tools, with the data looked up for it. */
export function fallbackSystem(base: string, data: { label: string; json: string }[]): string {
  const found = data.filter((d) => d.json && d.json !== "[]");
  return (
    base +
    "\n\nRight now you can't call tools. The app looked up this data for the customer's question; it is all you have. " +
    "Only use numbers and products from it, and if it doesn't answer the question, say so and point to the page where they can search." +
    (found.length ? found.map((d) => `\n\n${d.label}:\n${d.json}`).join("") : "\n\n(The lookup found nothing for this question.)")
  );
}
