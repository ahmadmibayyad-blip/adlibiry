// Does a product title read like a product name a visitor could sell, for the
// homepage showcase? Products built from ads sometimes carry the ad's headline
// ("Get 50% off your first box"), and Amazon titles are long keyword lists
// that start with a brand. Used to rank winners for winners:homepagePreview.

const HEADLINE = [
  /\d+\s*%/, // "50% off"
  /\b(off|save|sale|deal|discount|free shipping|shop now|order now|buy now|limited)\b/i,
  /^(get|save|buy|shop|discover|meet|introducing|try|the most|the best|our|we)\b/i,
  /\b(we|we've|we're|our|you|your|you're)\b/i,
  /[!?]/,
];

// A bracketed store tag such as "[medicube Ufficiale]" marks a brand's own listing.
const BRAND_TAG = /^\s*[[(【]/;

export const MAX_SHOWCASE_TITLE = 70;

export function readsLikeHeadline(title: string): boolean {
  return HEADLINE.some((re) => re.test(title));
}

/** 2 = short product name, 1 = a product name but long or brand-tagged, 0 = an ad headline. */
export function showcaseTitleRank(title: string): 0 | 1 | 2 {
  const t = title.trim();
  if (!t || readsLikeHeadline(t)) return 0;
  if (BRAND_TAG.test(t) || t.length > MAX_SHOWCASE_TITLE) return 1;
  return 2;
}
