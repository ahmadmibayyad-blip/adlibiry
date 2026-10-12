// Offer tags: the offers an ad's text promises ("Buy 2 get 1", "50% off",
// "Free shipping", "Code LENA20", "Ends today"), read with phrase rules in
// English, Danish, Swedish, Norwegian, German, Dutch, French and Spanish.
// Shown as chips on ad cards (src/pages/dashboard/ad-spy/_components/AdCard.tsx).
// Pure and unit tested; no network, no AI.

export type OfferKind = "bxgy" | "xfory" | "percent" | "free_shipping" | "code" | "free_gift" | "urgency";

export type OfferTag = {
  kind: OfferKind;
  label: string;
  /** The words in the ad that gave it away. */
  match: string;
};

// \b only knows ASCII letters, so word edges ({S} start, {E} end) are lookarounds that also know æøåäöüéñ.
const L = "\\p{L}\\p{N}";
const rx = (src: string) => new RegExp(src.replace(/\{S\}/g, `(?<![${L}])`).replace(/\{E\}/g, `(?![${L}])`), "giu");

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  en: 1, et: 1, ett: 1, ein: 1, eine: 1, einen: 1, een: 1, un: 1, une: 1, uno: 1, una: 1,
  to: 2, två: 2, zwei: 2, twee: 2, deux: 2, dos: 2,
  tre: 3, drei: 3, drie: 3, trois: 3, tres: 3,
};
const N = "(\\d{1,2}|one|two|three|four|five|en|et|ett|ein|eine|einen|een|un|une|uno|una|to|två|zwei|twee|deux|dos|tre|drei|drie|trois|tres)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s.toLowerCase()]);
/** The "get" number: a whole word, and not "get 10%". */
const GET = `${N}{E}(?!\\s?%|[.,]\\d)`;
/** A few words in between, within one sentence. */
const GAP = "[^.!?\\n]{0,40}?";

// "Buy 2 get 1 (free)", in every language we read. Groups: buy, get.
const BXGY: RegExp[] = [
  rx(`{S}buy ${N}{E}${GAP}get ${GET}`),
  rx(`{S}køb ${N}{E}${GAP}få ${GET}`), // da
  rx(`{S}köp ${N}{E}${GAP}få ${GET}`), // sv
  rx(`{S}kjøp ${N}{E}${GAP}få ${GET}`), // no
  rx(`{S}kaufe?n? ${N}{E}${GAP}(?:erhalte|bekomme)\\s+${GET}${GAP}(?:gratis|geschenkt|kostenlos|dazu)`), // de
  rx(`{S}koop ${N}{E}${GAP}(?:krijg|ontvang)\\s+(?:er\\s+)?${GET}\\s*(?:gratis|cadeau)`), // nl
  rx(`{S}ach[eè]te[zr]? ${N}{E}${GAP}${GET}\\s*(?:offerte?s?|gratuite?s?)`), // fr
  rx(`{S}${N} achet[ée]e?s?\\s*=\\s*${GET}\\s*offerte?s?`), // fr "1 acheté = 1 offert"
  rx(`{S}compra ${N}{E}${GAP}(?:llévate|lleva|recibe)\\s+${GET}`), // es
  rx(`{S}(\\d)\\s?\\+\\s?(\\d){E}\\s*(?:gratis|free|deal|aktion|angebot|tilbud|erbjudande|actie|offert|gratuit|regalo)`), // "2+1 gratis", "1+1 Deal"
];

// "3 for 2", "5 par til prisen for 2", "køb 3 – betal for 2", "3x2". Groups: get, pay.
const XFORY: RegExp[] = [
  rx(
    `{S}(\\d{1,2}) (?:\\p{L}+\\.? )?(?:for|til|för|für|voor|pour|por) (?:the price of |prisen (?:for|af|av) |priset (?:av|för) |den preis von |de prijs van |le prix de |el precio de )?(\\d{1,2}){E}(?![.,]\\d|\\s?(?:€|\\$|£|kr|dkk|sek|nok|eur|usd|,-))`,
  ),
  rx(`{S}(\\d{1,2}) (?:\\p{L}+ )?zum preis von (\\d{1,2}){E}`),
  rx(`{S}(?:køb|köp|kjøp|buy|kaufe|koop) (\\d{1,2})[,\\s–-]+(?:betal|betala|pay|zahle|betaal)\\s+(?:kun\\s+|endast\\s+|bara\\s+|only\\s+|nur\\s+|maar\\s+)?(?:for|för|für|voor)\\s+(\\d{1,2}){E}`),
  rx(`(?<![\\p{L}\\p{N}x×])(\\d)\\s?x\\s?(\\d)(?![\\p{L}\\p{N}]|\\s?(?:cm|mm|m|in|ft)\\b)`), // es "3x2"
];

const UP_TO = "(up to|op til|opp ?til|upp till|bis zu|tot wel|tot|jusqu'à|hasta)";
const PERCENT: RegExp[] = [
  // "50% off", "50 % rabat", "Bis zu 60 % Rabatt". Groups: up to, value.
  rx(`(?:{S}${UP_TO}\\s+)?(?<![\\p{N}])(\\d{1,2})\\s?%\\s?(?:off|rabat|rabatt|korting|discount|réduction|de réduction|descuento|de descuento|aus|nachlass|billigere|reduction){E}`),
  // "spar 20%", "save up to 66%", "spare heute zusätzlich 20%". Groups: up to, value.
  rx(
    `{S}(?:spar|spare|sparen|save|bespaar|économisez|ahorra|get|få|erhalte|ontvang|sichere dir|profiteer van)\\s+(?:(?:heute|today|i dag|idag|nu|jetzt|now|vandaag|nog)\\s+)*(?:${UP_TO}\\s+)?(?:extra\\s+|zusätzlich\\s+|ekstra\\s+|an additional\\s+)?(\\d{1,2})\\s?%`,
  ),
  // "-40%". Group: value.
  rx(`(?<![\\p{L}\\p{N}])-(\\d{1,2})\\s?%`),
];
const HALF_PRICE = rx(`{S}(?:half price|halv pris|halva priset|halve prijs|halber preis|halben preis|moitié prix|mitad de precio){E}`);

const FREE_SHIPPING = rx(
  `{S}(?:free (?:worldwide |standard |express |2-day |fast )?(?:shipping|delivery)|gratis (?:fragt|levering|forsendelse|frakt|leverans|versand|lieferung|verzending|bezorging)|fri (?:fragt|frakt|leverans)|kostenlose[rn]? (?:versand|lieferung)|versandkostenfrei|livraison (?:gratuite|offerte)|env[ií]o (?:gratis|gratuito)){E}`,
);
// Right after it: "over 799 kr", "vanaf €75", "ab 69 €" (a minimum order).
const SHIPPING_MIN =
  /^[\s:*–-]*(?:on orders over|orders over|over|from|ved køb over|ved kjøp over|vid köp över|över|fra|ab|vanaf|boven|dès|à partir de|desde|a partir de)\s+((?:[€$£]\s?)?\d[\d.,]*(?:\s?(?:kr\.?|dkk|sek|nok|€|eur|usd|\$|,-))?)/iu;

const CODE = rx(
  `{S}(?:discount code|promo ?code|code promo|coupon code|coupon|use code|brug kode|rabatkoden|rabatkode|rabattkoden|rabattkod|rabattkode|rabattcode|gutscheincode|mit dem code|mit code|kortingscode|met (?:de )?code|avec le code|con el código|código|cupón|koden|kode|code)\\s*[:：]?\\s*["'“”‘’«»]?([A-Za-z][A-Za-z0-9]{2,19}|\\d[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*){E}`,
);
// Words after "code" that aren't codes.
const NOT_CODES = new Set(["IS", "AT", "IN", "FOR", "THE", "AND", "OG", "UND", "EN", "ER", "TIL", "BELOW", "HERE", "HER", "HIER", "ICI", "AQUI", "WILL", "WIRD", "VIA", "PROMO"]);

const FREE_GIFT = rx(
  `{S}(?:free gifts?|free (?:bonus|surprise|mystery) gift|gratis (?:gave|gaven|gaver|geschenk|geschenke|gåva|gåvor|cadeau|cadeautje|regalo)|geschenk gratis|überraschungsgeschenk|cadeau offert|regalo gratis){E}`,
);

const ENDS_TODAY = rx(
  `{S}(?:ends today|today only|only today|last day|letzter tag|kun i dag|slutter i dag|sidste dag|endast idag|endast i dag|bara idag|bara i dag|sista dagen|siste dag|nur heute|heute nur|endet heute|alleen vandaag|laatste dag|aujourd'hui seulement|dernier jour|s[oó]lo hoy|[uú]ltimo d[ií]a){E}`,
);
const ENDS_SOON = rx(
  `{S}(?:ending soon|ends soon|last chance|slutter snart|sidste chance|slutar snart|sista chansen|siste sjanse|endet bald|letzte chance|eindigt binnenkort|laatste kans|se termine bientôt|derni[eè]re chance|termina pronto|[uú]ltima oportunidad){E}`,
);
const LIMITED = rx(
  `{S}(?:limited time|begrænset tid|begränsad tid|tidsbegrenset|begrenset tid|zeitlich begrenzt|nur für kurze zeit|tijdelijk|voor korte tijd|durée limitée|temps limité|tiempo limitado){E}`,
);
const BOGO = rx(`{S}bogo{E}`);

// No-break spaces (U+00A0, U+202F) read as plain spaces.
const NBSP = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, "g");

const ORDER: OfferKind[] = ["bxgy", "xfory", "percent", "free_shipping", "code", "free_gift", "urgency"];

/** The offers an ad's text promises, most specific first, without duplicates. */
export function offerTags(text: string | undefined | null): OfferTag[] {
  if (!text) return [];
  const t = text.normalize("NFC").replace(NBSP, " ").slice(0, 4000);
  const tags: OfferTag[] = [];
  const add = (kind: OfferKind, label: string, match: string) => {
    if (!tags.some((x) => x.label.toLowerCase() === label.toLowerCase())) tags.push({ kind, label, match: match.trim() });
  };
  const each = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    for (const m of t.matchAll(re)) fn(m);
  };

  for (const re of BXGY)
    each(re, (m) => {
      const buy = toNum(m[1]);
      const get = toNum(m[2]);
      if (buy && get && buy <= 20 && get <= 20) add("bxgy", `Buy ${buy} get ${get}`, m[0]);
    });
  each(BOGO, (m) => add("bxgy", "Buy 1 get 1", m[0]));
  for (const re of XFORY)
    each(re, (m) => {
      const get = Number(m[1]);
      const pay = Number(m[2]);
      if (get > pay && pay >= 1 && get <= 20) add("xfory", `${get} for ${pay}`, m[0]);
    });

  for (const re of PERCENT)
    each(re, (m) => {
      const upTo = m.length > 2 && !!m[1];
      const value = Number(m[m.length - 1]);
      if (value >= 5 && value <= 90) add("percent", `${upTo ? "Up to " : ""}${value}% off`, m[0]);
    });
  each(HALF_PRICE, (m) => add("percent", "Half price", m[0]));

  each(FREE_SHIPPING, (m) => {
    const end = (m.index ?? 0) + m[0].length;
    const min = SHIPPING_MIN.exec(t.slice(end, end + 40));
    add("free_shipping", min ? `Free shipping over ${min[1].trim().replace(/[.,]+$/, "")}` : "Free shipping", m[0]);
  });

  each(CODE, (m) => {
    const code = m[1].toUpperCase();
    // A code is written in capitals or has a digit; "code at checkout" isn't one.
    if (NOT_CODES.has(code)) return;
    if (!/\d/.test(m[1]) && m[1] !== m[1].toUpperCase()) return;
    add("code", `Code ${code}`, m[0]);
  });

  each(FREE_GIFT, (m) => add("free_gift", "Free gift", m[0]));

  each(ENDS_TODAY, (m) => add("urgency", "Ends today", m[0]));
  if (!tags.some((x) => x.kind === "urgency")) each(ENDS_SOON, (m) => add("urgency", "Ends soon", m[0]));
  if (!tags.some((x) => x.kind === "urgency")) each(LIMITED, (m) => add("urgency", "Limited time", m[0]));

  // "75% off" and "up to 75% off" in one ad are one offer.
  const out = tags.filter((x) => !(x.label.startsWith("Up to ") && tags.some((y) => y.label === x.label.slice(6))));
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
