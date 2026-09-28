// Niche (category) classifier shared by every importer, the CSV import
// (browser) and the extension moderation form.
//
// The old version returned the FIRST category whose regex matched anywhere,
// so "dog collar" became Fashion (collar), a car-seat for babies became Home
// (car), and any ad containing "smart" or "LED" became Electronics. Ads
// imported by keyword search were also filed under the search niche, not what
// they actually sell. This version scores every niche:
//   • strong terms (product nouns) count more than weak/ambiguous ones,
//   • words in the title / product-URL slug count more than body copy,
//   • common Danish/Swedish/Norwegian/German/Spanish words are covered, since
//     most imports are Nordic/EU ads,
// and only answers when the winner is clear. Otherwise it returns the caller's
// fallback (e.g. the search niche) or "Other".

export const NICHES = [
  "Beauty",
  "Fashion",
  "Jewelry",
  "Health & Wellness",
  "Sports",
  "Home & Living",
  "Electronics",
  "Pet Supplies",
  "Baby & Kids",
  "Toys",
  "Automotive",
  "Other",
] as const;
export type Niche = (typeof NICHES)[number];

type Rule = { niche: Niche; strong: string[]; weak?: string[] };

// Plurals ("s"/"es") are matched automatically.
const RULES: Rule[] = [
  {
    niche: "Pet Supplies",
    strong: [
      "dog", "puppy", "puppies", "cat", "kitten", "pet", "leash", "litter", "aquarium", "catnip", "chew toy",
      "dog bed", "cat tree", "scratching post", "paw", "hund", "hvalp", "valp", "kat", "katt", "killing",
      "kattunge", "katze", "perro", "gato", "mascota",
    ],
    weak: ["harness", "collar", "grooming", "treat", "kennel", "fur"],
  },
  {
    niche: "Baby & Kids",
    strong: [
      "baby", "babies", "infant", "newborn", "toddler", "nursery", "stroller", "diaper", "nappy", "pacifier",
      "crib", "onesie", "breastfeeding", "maternity", "pregnancy", "pregnant", "barnevogn", "bebis", "barnvagn",
      "kinderwagen", "bebé",
    ],
    // Who a product is *for* ("toys for kids", "shoes for children") is weaker
    // evidence than what it *is*.
    weak: ["kids", "children", "child", "børn", "barn", "kinder", "niños", "mom", "mum", "parenting", "bottle"],
  },
  {
    niche: "Toys",
    strong: [
      "toy", "lego", "puzzle", "doll", "plush", "plushie", "rc car", "building blocks", "montessori", "board game",
      "fidget", "slime", "hot wheels", "legetøj", "leksak", "leksaker", "spielzeug", "juguete",
    ],
    weak: ["game", "play", "playset", "dino"],
  },
  {
    niche: "Beauty",
    strong: [
      "skincare", "skin care", "serum", "moisturizer", "moisturiser", "makeup", "make-up", "mascara", "lipstick",
      "lip gloss", "lip balm", "lip oil", "eyelash", "lashes", "eyebrow", "brow", "nail", "manicure", "pedicure",
      "shampoo", "conditioner", "hair growth", "hair oil", "hair dryer", "hair straightener", "straightener",
      "curler", "curling iron", "perfume", "parfum", "parfume", "fragrance", "cosmetic", "sunscreen", "spf",
      "wrinkle", "acne", "facial", "face mask", "beauty", "wig", "teeth whitening", "whitening", "body lotion",
      "body oil", "body wash", "cream", "lotion", "blanqueamiento", "labial", "hudpleje", "hudvård", "hautpflege",
      "negle", "naglar", "skønhed", "skönhet",
    ],
    weak: ["hair", "hår", "skin", "hud", "face", "balm", "anti-aging", "toner", "glow", "teeth"],
  },
  {
    niche: "Health & Wellness",
    strong: [
      "posture", "massager", "massage", "pain relief", "back pain", "neck pain", "joint pain", "supplement",
      "vitamin", "gummies", "probiotic", "collagen", "insomnia", "snoring", "orthopedic", "knee brace", "detox",
      "weight loss", "acupressure", "wellness", "blood pressure", "digestion", "anxiety", "stress relief",
      "tens unit", "sleep", "smerte", "smerter", "smärta", "søvn", "sömn", "schmerzen", "schlaf", "kosttilskud",
    ],
    weak: ["health", "healthy", "pain", "tea", "matcha", "cushion", "relief", "brace", "recovery", "therapy", "sundhed", "hälsa"],
  },
  {
    niche: "Sports",
    strong: [
      "fitness", "gym", "yoga", "workout", "dumbbell", "kettlebell", "resistance band", "treadmill", "bicycle",
      "cycling", "running", "runner", "marathon", "golf", "fishing", "camping", "hiking", "football", "soccer",
      "tennis", "padel", "basketball", "swimming", "surf", "skiing", "sports", "træning", "träning", "løb",
      "löpning", "fiskeri",
    ],
    weak: ["bike", "training", "exercise", "outdoor", "athlete", "trail", "sport", "protein"],
  },
  {
    niche: "Electronics",
    strong: [
      "charger", "charging", "usb", "bluetooth", "earbuds", "earphones", "headphones", "speaker", "smartwatch",
      "smart watch", "camera", "drone", "power bank", "projector", "keyboard", "laptop", "tablet", "iphone",
      "android", "phone case", "phone holder", "dash cam", "gadget", "led strip", "led lights", "wifi",
      "gaming", "console", "stylus", "magsafe", "electronics", "oplader", "laddare", "høretelefoner", "hörlurar",
      "kopfhörer", "ladegerät",
    ],
    weak: ["phone", "telefon", "wireless", "smart", "led", "battery", "electric", "magnetic", "mouse", "cable"],
  },
  {
    niche: "Jewelry",
    strong: [
      "jewelry", "jewellery", "necklace", "pendant", "bracelet", "earring", "anklet", "charm bracelet",
      "gold plated", "sterling silver", "diamond", "moissanite", "gemstone", "collier", "smykke", "smykker",
      "smycke", "smycken", "halskæde", "armbånd", "øreringe", "örhängen", "schmuck", "halskette", "joyería",
    ],
    weak: ["ring", "gold", "silver", "charm"],
  },
  {
    niche: "Fashion",
    strong: [
      "dress", "vestido", "shirt", "t-shirt", "tshirt", "hoodie", "sweatshirt", "sweater", "cardigan", "jacket",
      "coat", "pants", "jeans", "denim", "leggings", "shorts", "skirt", "romper", "jumpsuit", "blouse", "blazer",
      "trousers", "kimono", "pajamas", "pyjamas", "lingerie", "bikini", "swimsuit", "swimwear", "sneaker",
      "shoe", "boots", "sandal", "heels", "handbag", "purse", "wallet", "sunglasses", "beanie", "scarf", "sock",
      "abaya", "fashion", "outfit", "apparel", "clothing", "kjole", "klänning", "bukser", "byxor", "jakke",
      "jacka", "sko", "skor", "taske", "väska", "kleid", "schuhe", "tøj", "kläder",
    ],
    // "bra" is weak: in Swedish ads it means "good".
    weak: ["bra", "bag", "watch", "top", "wear", "style", "knit", "silk", "lace", "velvet", "cotton", "linen", "hat", "cap"],
  },
  {
    niche: "Home & Living",
    strong: [
      "kitchen", "cookware", "knife", "knives", "blender", "air fryer", "coffee maker", "mug", "home decor",
      "decor", "wall art", "lamp", "furniture", "sofa", "rug", "carpet", "curtain", "bedding", "mattress",
      "duvet", "blanket", "towel", "bathroom", "shower", "vacuum", "mop", "cleaning", "cleaner", "organizer",
      "organiser", "storage", "garden", "plant", "candle", "ornament", "vase", "køkken", "kök", "lampe", "lampa",
      "trädgård", "havemøbler", "küche", "garten", "möbel", "møbler", "möbler",
    ],
    weak: ["home", "house", "room", "bed", "wall", "cozy", "pillow", "chair", "pan", "frame", "hjem", "christmas"],
  },
  {
    niche: "Automotive",
    strong: [
      "car mount", "car phone mount", "car phone holder", "car holder", "car charger", "car seat cover", "car wash", "car accessories", "tire", "tyre", "windshield",
      "wiper", "obd", "motorcycle", "dashboard", "vehicle", "bil", "bilen", "auto zubehör",
    ],
    weak: ["car", "truck", "driving", "garage", "auto"],
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Unicode-aware word boundaries (\b doesn't treat æ/ø/å/ä/ö as letters).
const termRe = (terms: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map((t) => escape(t).replace(/ /g, "[\\s-]+")).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu");
const COMPILED = RULES.map((r) => ({ niche: r.niche, strong: termRe(r.strong), weak: r.weak?.length ? termRe(r.weak) : null }));

function distinctMatches(re: RegExp, text: string): number {
  if (!text) return 0;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) seen.add(m[0].toLowerCase());
  return Math.min(seen.size, 4);
}

// "https://shop.dk/products/no-pull-dog-harness?x=1" → "shop dk products no pull dog harness"
function urlWords(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return decodeURIComponent(`${u.hostname} ${u.pathname}`).replace(/[^\p{L}\p{N}]+/gu, " ");
  } catch {
    return "";
  }
}

export type NicheInput = { title?: string; body?: string; url?: string; advertiser?: string };

export function scoreNiches(input: NicheInput): { niche: Niche; score: number }[] {
  const primary = `${input.title ?? ""} ${urlWords(input.url)}`.toLowerCase();
  const secondary = `${(input.body ?? "").slice(0, 600)} ${input.advertiser ?? ""}`.toLowerCase();
  return COMPILED.map((r) => ({
    niche: r.niche,
    score:
      3 * distinctMatches(r.strong, primary) +
      2 * distinctMatches(r.strong, secondary) +
      (r.weak ? 1 * distinctMatches(r.weak, primary) + 0.5 * distinctMatches(r.weak, secondary) : 0),
  })).sort((a, b) => b.score - a.score);
}

// Best niche when the evidence is clear (at least one strong term, or several
// weak ones, and ahead of the runner-up); otherwise `fallback` or "Other".
export function classifyNiche(input: NicheInput, fallback?: string): string {
  const [best, second] = scoreNiches(input);
  if (best && best.score >= 2 && best.score > (second?.score ?? 0)) return best.niche;
  return fallback || "Other";
}

// Back-compat wrapper (CSV import, WinningHunter transform, moderation form).
export function guessCategory(title: string, hint?: string): string {
  return classifyNiche({ title, body: hint });
}
