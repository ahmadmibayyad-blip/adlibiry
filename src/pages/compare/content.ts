// Comparison pages (/vs/<slug>). The build also writes each one as static HTML
// (vite.config.ts comparePages → dist/vs/<slug>.html) so search engines read
// the text without running the app.
// Competitor facts are only what their own sites showed on CHECKED; re-check
// prices before changing them (PiPiADS's annual price is a Q4 promo until 31 Dec).

export const CHECKED = "22 October 2026";

export type Row = { feature: string; us: string; them: string };
export type ComparePage = {
  slug: string;
  name: string; // the competitor
  title: string; // <title> and h1
  description: string; // meta description
  intro: string;
  rows: Row[];
  theyWin: string[]; // where the competitor is stronger (honest)
  weWin: string[];
  pickThem: string;
  pickUs: string;
  sources: string[];
};

// AdSpy Pro's side, shared by every table.
const US = {
  price: "€35/month, or €30/month paid yearly (€360). One plan with everything.",
  trial: "7 days free, no card (smaller daily limits, no Launch). Then Free: the first 10 results of every list.",
  meta: "Yes: Facebook and Instagram ads, with EU reach (Meta's DSA data) and estimated spend",
  tiktok: "TikTok ads and TikTok Shop products",
  stores: "Store tracker and Store Inspector: theme, apps, pixels, ads running, Google & YouTube ads",
  suppliers: "AliExpress (incl. search by picture) and CJ Dropshipping, with landed cost and margin",
  aiVideo: "Why this video works (hook, angle, beats), Write my version, and Make the video with an AI actor",
  launch: "Launch to Shopify (Pro: 5 products, 3 as full stores), plus Screenshot to page",
  extras: "Ask AI, daily AI agents, Chrome extension, API and an MCP connector for Claude",
};

export const COMPARE_PAGES: ComparePage[] = [
  {
    slug: "minea",
    name: "Minea",
    title: "AdSpy Pro vs Minea: an honest comparison (2026)",
    description:
      "AdSpy Pro vs Minea compared on price, trial, platforms, EU ad reach, suppliers and AI tools. AdSpy Pro starts at €35/month with a 7-day trial, no card.",
    intro:
      "Minea is one of the best-known spy tools for dropshippers. Here's how it compares with AdSpy Pro, using what each site showed on " +
      CHECKED +
      ".",
    rows: [
      { feature: "Price", us: US.price, them: "Starter $49, Premium $99, Business $199 a month; $39 / $79 / $158 a month paid quarterly" },
      { feature: "Trial", us: US.trial, them: "\"Try for free\"; trial length not stated" },
      { feature: "Facebook & Instagram ads", us: US.meta, them: "Yes, with spend and activity filters" },
      { feature: "TikTok", us: US.tiktok, them: "TikTok ads listing in the plan table; influencer product placements" },
      { feature: "Stores", us: US.stores, them: "Shops listing with traffic, revenue, top ads and apps" },
      { feature: "Suppliers", us: US.suppliers, them: "\"Find supplier\" and an AliExpress product finder" },
      { feature: "AI on ad videos", us: US.aiVideo, them: "AI ad analysis and transcripts: 10 / 50 a month on Starter / Premium, unlimited on Business" },
      { feature: "Build a store", us: US.launch, them: "Turn a product into a Shopify store" },
      { feature: "Extras", us: US.extras, them: "Chrome extension, brand tracker, Magic search (image)" },
    ],
    theyWin: [
      "A much bigger ad database: Minea says 80M+ active ads; AdSpy Pro is newer and tracks fewer.",
      "Influencer product placements, which AdSpy Pro doesn't cover.",
      "A large community and many creator tutorials.",
    ],
    weWin: [
      "Lower price: €35 a month for everything, against $49 for Minea's entry plan with monthly AI caps.",
      "From a winning ad to your own version: analyse why the video works, get a script for your product, and make the video with an AI actor.",
      "CJ Dropshipping next to AliExpress, with shipping to your country and the margin worked out.",
      "Spend estimates you can adjust: set your own CPM instead of a fixed one.",
    ],
    pickThem: "Pick Minea if you mainly want the largest possible ad archive and influencer placements.",
    pickUs: "Pick AdSpy Pro if you want to find a product and act on it (ad script, video, store) in one tool, for less.",
    sources: ["minea.com/pricing", "minea.com"],
  },
  {
    slug: "winninghunter",
    name: "WinningHunter",
    title: "AdSpy Pro vs WinningHunter: an honest comparison (2026)",
    description:
      "AdSpy Pro vs WinningHunter on price, trial, platforms, store tracking and AI tools. AdSpy Pro is €35/month with a 7-day trial, no card needed.",
    intro: "WinningHunter is a popular ad spy for Shopify sellers. Here's how it compares with AdSpy Pro, from both sites on " + CHECKED + ".",
    rows: [
      { feature: "Price", us: US.price, them: "Basic $49, Standard $79, Enterprise $249 a month; quarterly saves 15%, yearly 40%" },
      { feature: "Trial", us: US.trial, them: "Free start, no credit card; trial length not stated" },
      { feature: "Facebook & Instagram ads", us: US.meta, them: "Facebook ads with real-time ad scores and spend data" },
      { feature: "TikTok", us: US.tiktok, them: "TikTok Shop on Basic; TikTok ads from Standard ($79)" },
      { feature: "Pinterest", us: "No", them: "From Standard ($79)" },
      { feature: "Stores", us: US.stores, them: "Store tracker (25 stores on Basic) and Store Explorer" },
      { feature: "Suppliers", us: US.suppliers, them: "Not shown on their site" },
      { feature: "AI on ad videos", us: US.aiVideo, them: "Magic AI saturation check and AI reverse ad search" },
      { feature: "Build a store", us: US.launch, them: "Product importing" },
      { feature: "Extras", us: US.extras, them: "Exploding Trends (Enterprise), target CPA calculator" },
    ],
    theyWin: [
      "Pinterest ads, which AdSpy Pro doesn't track.",
      "A much bigger database: WinningHunter says 300M+ ads and 5M+ stores.",
      "1-on-1 weekly calls on their Enterprise plan.",
    ],
    weWin: [
      "TikTok ads, TikTok Shop and every tool at €35 a month; WinningHunter's TikTok ads start at $79.",
      "Supplier prices from AliExpress and CJ on every product, so you see the margin before you test.",
      "Make your own version of a winning ad: script, voice-over and AI actor video.",
      "Launch a product page or a full store to Shopify from the product.",
    ],
    pickThem: "Pick WinningHunter if you need Pinterest ads or the largest store database.",
    pickUs: "Pick AdSpy Pro if you want ads, suppliers, margins and ready-made creatives in one place for less.",
    sources: ["winninghunter.com (pricing section)"],
  },
  {
    slug: "adspy",
    name: "AdSpy",
    title: "AdSpy Pro vs AdSpy (adspy.com): what's the difference?",
    description:
      "AdSpy Pro and AdSpy.com are different companies. Compare price ($149 vs €35/month), platforms, products, suppliers and AI tools.",
    intro:
      "AdSpy Pro (adspypro.net) isn't AdSpy (adspy.com): they're two separate companies with similar names. AdSpy is an older Facebook and Instagram ad search engine. Here's how they differ, from both sites on " +
      CHECKED +
      ".",
    rows: [
      { feature: "Price", us: US.price, them: "$149 a month (one plan, \"introductory offer\")" },
      { feature: "Trial", us: US.trial, them: "Not stated on their site" },
      { feature: "Facebook & Instagram ads", us: US.meta, them: "Yes: search by ad text, URL, page, comments, likes, demographics" },
      { feature: "TikTok", us: US.tiktok, them: "Not mentioned" },
      { feature: "Winning products", us: "Product database with an AdSpy score, estimated revenue and margin", them: "No product database" },
      { feature: "Stores", us: US.stores, them: "Landing-page tech search" },
      { feature: "Suppliers", us: US.suppliers, them: "No" },
      { feature: "AI tools", us: US.aiVideo, them: "No" },
      { feature: "Build a store", us: US.launch, them: "No" },
    ],
    theyWin: [
      "A huge archive: AdSpy says 213M+ ads in 88 languages and 225 countries.",
      "Search tools for affiliate marketers: affiliate networks, offer IDs, comment search.",
    ],
    weWin: [
      "Less than a quarter of the price: €35 against $149 a month.",
      "Made for e-commerce: winning products, stores, suppliers and margins, not only ads.",
      "TikTok ads and TikTok Shop.",
      "AI that turns a winning ad into your own script and video, and a store you can launch.",
    ],
    pickThem: "Pick AdSpy (adspy.com) if you're an affiliate marketer who needs deep Facebook ad search.",
    pickUs: "Pick AdSpy Pro if you sell physical products online and want to go from ad to product to store.",
    sources: ["adspy.com"],
  },
  {
    slug: "pipiads",
    name: "PiPiADS",
    title: "AdSpy Pro vs PiPiADS: an honest comparison (2026)",
    description:
      "AdSpy Pro vs PiPiADS on price, credits, TikTok and Meta coverage, suppliers and AI tools. AdSpy Pro is €35/month with no credits to count.",
    intro: "PiPiADS is a TikTok-first ad library that also covers Meta. Here's how it compares with AdSpy Pro, from both sites on " + CHECKED + ".",
    rows: [
      { feature: "Price", us: US.price, them: "Basic $49, Advanced $99, Enterprise $900 a month; annual at half price until 31 Dec (Q4 offer)" },
      { feature: "How usage works", us: "No credits. Daily limits only on AI tools", them: "Credits: 1 per ad in a list, 20 per ad opened; Basic has 30,000 a month" },
      { feature: "Trial", us: US.trial, them: "500 credits, ads only, no ad details. No refunds" },
      { feature: "TikTok", us: US.tiktok, them: "TikTok ads and TikTok Shop" },
      { feature: "Meta ads", us: US.meta, them: "Facebook, Instagram, Audience Network, Messenger, Threads" },
      { feature: "Stores", us: US.stores, them: "Store intelligence (Shopify, WooCommerce)" },
      { feature: "Suppliers", us: US.suppliers, them: "Not shown on their site" },
      { feature: "AI on ad videos", us: US.aiVideo, them: "Script and hook tags; translator, text removal and transcripts sold separately" },
      { feature: "Build a store", us: US.launch, them: "No" },
    ],
    theyWin: [
      "Deeper TikTok ad coverage, including apps, games and short drama ads.",
      "Ads from Audience Network, Messenger and Threads too.",
    ],
    weWin: [
      "No credits: open as many ads and products as you like for €35 a month.",
      "A 7-day trial without a card that opens ad and product details; PiPiADS's trial shows ads only.",
      "Suppliers and margins on every product, and Launch to Shopify.",
      "AI video tools included in the plan, not sold separately.",
    ],
    pickThem: "Pick PiPiADS if TikTok ads outside e-commerce (apps, games) matter to you.",
    pickUs: "Pick AdSpy Pro if you want to research and launch e-commerce products without counting credits.",
    sources: ["pipiads.com/pricing", "pipiads.com"],
  },
  {
    slug: "kalodata",
    name: "Kalodata",
    title: "AdSpy Pro vs Kalodata: an honest comparison (2026)",
    description:
      "AdSpy Pro vs Kalodata: Meta and TikTok ads, Shopify stores and suppliers vs deep TikTok Shop data. Both have a 7-day trial without a card.",
    intro:
      "Kalodata is a TikTok Shop analytics tool. AdSpy Pro covers ads across Meta and TikTok, Shopify stores and suppliers. Here's how they compare, from both sites on " +
      CHECKED +
      ".",
    rows: [
      { feature: "Price", us: US.price, them: "Only shown after you sign up" },
      { feature: "Trial", us: US.trial, them: "7 days free, no card" },
      { feature: "TikTok Shop", us: "TikTok Shop best sellers and live search (US, BR, MX, JP, Southeast Asia)", them: "Their focus: products, shops, creators, videos, livestreams; 1,000 days of history" },
      { feature: "Facebook & Instagram ads", us: US.meta, them: "No" },
      { feature: "Shopify stores", us: US.stores, them: "No" },
      { feature: "Suppliers", us: US.suppliers, them: "No" },
      { feature: "AI tools", us: US.aiVideo, them: "Kaloclip (AI content), kalopilot (market insights agent)" },
      { feature: "Build a store", us: US.launch, them: "No" },
    ],
    theyWin: [
      "Far deeper TikTok Shop data: creators, livestreams and long sales history.",
      "Creator discovery for TikTok Shop affiliate campaigns.",
    ],
    weWin: [
      "Facebook and Instagram ads with EU reach, which Kalodata doesn't cover.",
      "Shopify store research, suppliers and margins.",
      "A public price: €35 a month.",
    ],
    pickThem: "Pick Kalodata if you sell on TikTok Shop and work with creators.",
    pickUs: "Pick AdSpy Pro if you run a Shopify store and advertise on Meta or TikTok.",
    sources: ["kalodata.com", "kalodata.com/pricing"],
  },
];

export const compareBySlug = (slug: string) => COMPARE_PAGES.find((p) => p.slug === slug);
