// Keyword-based category guess shared by CSV import (browser) and backend importers.
const KEYWORDS: [string, RegExp][] = [
  ["Pet Supplies", /\b(dogs?|cats?|pets?|puppy|puppies|kitten|leash|harness|litter|aquarium|bird ?cage|chew toy|hund|katze|perro|gato)\b/i],
  ["Toys", /\b(toys?|lego|puzzles?|doll|plush|rc car|building blocks|montessori|hot wheels|juguete|dino)\b/i],
  ["Beauty", /\b(skin ?care|serum|cream|lotion|makeup|mascara|lipstick|labial|lip (balm|gloss|oil)|balm|lash(es)?|eyebrows?|nails?|hair|shampoo|conditioner|perfume|parfum|fragrance|facial|face mask|beauty|wigs?|cosmetics?|body (wash|glaze|oil|lotion)|teeth|whitening|blanqueamiento|tooth|cepillo alisador|straightener|curler|sunscreen|spf|skin)\b/i],
  ["Health & Wellness", /\b(posture|massager?|massage|pain relief|back pain|\bpain\b|supplements?|vitamins?|gummies|protein|collagen|health|sleep|therapy|orthopedic|knee|detox|weight loss|brace|acupressure|wellness|juice|tea|matcha|probiotic|tail ?bone|cushion|pillow for)\b/i],
  ["Sports", /\b(fitness|gym|yoga|workout|dumbbells?|resistance bands?|bike|bicycle|cycling|running|runner|sports?|golf|fishing|camping|hiking|football|soccer|tennis|padel|adizero|trail|bib)\b/i],
  ["Electronics", /\b(charger|cables?|usb|bluetooth|earbuds?|headphones?|speakers?|led|smart ?watch|smart|cameras?|drones?|power ?bank|iphone|phone ?case|phone|laptop|keyboard|mouse|projector|gadget|wireless|electric|magnetic|air pump|inflator|repair|car (charger|mount)|dash ?cam|tablet|stylus)\b/i],
  ["Fashion", /\b(dress|dresses|vestido|shirts?|t-?shirt|hoodie|sweatshirt|sweater|cardigan|jacket|coat|pants?|jeans|denim|leggings|shorts|skirt|romper|jumpsuit|crop top|tops?|blouse|blazer|vest|jumper|trousers|kimono|pajamas?|robe|suit|polo|knit|shoes?|sneakers?|boots?|sandals?|heels|bags?|handbag|wallet|watch|reloj|jewel(ry|lery)?|necklace|pendant|collier|collar|rings?|earrings?|bracelet|sunglasses|glasses|hats?|caps?|gorra|socks?|lingerie|bras?|bikini|swimsuit|fashion|abaya|scarf|velvet|embroidered|silk|lace|keychain)\b/i],
  ["Home & Living", /\b(kitchen|home|decor|wall art|wall|paintings?|plaque|ornaments?|christmas|advent|calendar|lamp|furniture|chair|sofa|pillow|blanket|towel|bath|shower|clean(er|ing)?|mop|storage|organi[sz]er|garden|plants?|curtains?|rug|mattress|bedding|cookware|knife|knives|coffee|mug|candles?|frame|door|windshield|car|stickers?|bell|glass|acrylic|personali[sz]ed|custom)\b/i],
];

export function guessCategory(title: string, hint?: string): string {
  const text = `${hint ?? ""} ${title}`;
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return "Other";
}
