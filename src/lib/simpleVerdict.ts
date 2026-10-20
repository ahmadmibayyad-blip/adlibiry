// Plain-language verdict and reasons for a product, for the Simple view's home.
// Built only from what the product row already has; a missing fact is left out.

export type Reason = { ok: boolean; text: string };
export type Verdict = { label: "Good to test" | "Worth a look" | "Think twice"; good: boolean; reasons: Reason[] };

type ProductFacts = {
  aiScore: number;
  saturation: string;
  trend: string;
  price?: number;
  cost?: number;
  priceSource?: string;
  linkedAds?: number;
};

export function simpleVerdict(p: ProductFacts, money: (usd: number) => string): Verdict {
  const reasons: Reason[] = [];
  const ads = p.linkedAds ?? 0;
  if (ads > 0) reasons.push({ ok: true, text: ads === 1 ? "A shop is paying to advertise it." : `Shops are running ${ads.toLocaleString("en")} ads for it.` });
  if (p.price !== undefined && p.cost !== undefined && p.price > p.cost) {
    const similar = p.priceSource === "estimated_market";
    reasons.push({
      ok: true,
      text: similar
        ? `Products like it sell for about ${money(p.price)} and cost about ${money(p.cost)}.`
        : `It sells for ${money(p.price)}. You can buy it for about ${money(p.cost)}.`,
    });
  }
  if (p.trend === "Rising") reasons.push({ ok: true, text: "More people are looking for it lately." });
  if (p.saturation === "Low") reasons.push({ ok: true, text: "Few stores sell it yet." });
  if (p.saturation === "High") reasons.push({ ok: false, text: "Watch out: many stores already sell it." });
  if (p.trend === "Declining") reasons.push({ ok: false, text: "Watch out: interest is going down." });

  const label = p.aiScore >= 70 && p.saturation !== "High" && p.trend !== "Declining"
    ? "Good to test"
    : p.aiScore >= 55
      ? "Worth a look"
      : "Think twice";
  // Warnings always show; good points fill the rest, three lines in all.
  const warnings = reasons.filter((r) => !r.ok);
  const good = reasons.filter((r) => r.ok).slice(0, Math.max(0, 3 - warnings.length));
  return { label, good: label !== "Think twice", reasons: [...good, ...warnings].slice(0, 3) };
}

// Marketplace titles run long ("MiraLAX Laxative Powder Gentle Constipation Relief for Adults ..."): the first `words` words.
export function shortTitle(title: string, words = 8) {
  const parts = title.trim().split(/\s+/);
  return parts.length > words ? `${parts.slice(0, words).join(" ")}…` : title;
}
