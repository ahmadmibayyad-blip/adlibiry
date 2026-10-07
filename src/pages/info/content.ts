// Text for the footer's info pages (/about, /privacy, …). One entry per page.
// CONTACT_EMAIL: shown on pages when set — fill it in (src/lib/site.ts).

export type Section = { heading?: string; paragraphs?: string[]; bullets?: string[] };
export type InfoPage = { slug: string; group: "Company" | "Support" | "Legal"; title: string; intro: string; sections: Section[] };

export const UPDATED = "2 October 2026";

export const INFO_PAGES: InfoPage[] = [
  // ── Company ────────────────────────────────────────────────────────────────
  {
    slug: "about",
    group: "Company",
    title: "About AdSpy Pro",
    intro: "AdSpy Pro helps dropshippers and e-commerce sellers find products that sell, before the market is crowded.",
    sections: [
      {
        heading: "What we do",
        paragraphs: [
          "Every day we collect running ads from Facebook, Instagram and TikTok, bestsellers from Amazon, TikTok Shop and Shopify stores, and turn them into one searchable place: winning products, the ads that sell them, and the stores behind them.",
          "Our AI scores each product, explains why it could sell, writes hooks and ad copy, and can run research for you every morning.",
        ],
      },
      {
        heading: "How we work",
        bullets: [
          "Real data first. Numbers like views, likes and days running come straight from the source.",
          "Honest estimates. Revenue, spend and sales we can't see directly are always shown as ranges and marked as estimates.",
          "Built for sellers. Every feature should save you time when choosing the next product to test.",
        ],
      },
    ],
  },
  {
    slug: "blog",
    group: "Company",
    title: "Blog",
    intro: "Guides on finding winning products, reading ad data and testing products on a small budget.",
    sections: [
      {
        paragraphs: [
          "Our first articles are on the way. Until then, the best learning material is inside the app: Hooks of the week shows the best ad openings of the week with a template for each, and every product page explains its score.",
        ],
      },
    ],
  },
  {
    slug: "careers",
    group: "Company",
    title: "Careers",
    intro: "We're a small team building the research tool we wanted as sellers ourselves.",
    sections: [
      {
        paragraphs: [
          "We have no open positions right now. If you work in e-commerce data, ad research or product, we're still happy to hear from you.",
        ],
      },
    ],
  },
  {
    slug: "press",
    group: "Company",
    title: "Press",
    intro: "Writing about e-commerce, dropshipping or ad intelligence? We can help.",
    sections: [
      {
        heading: "About AdSpy Pro in one line",
        paragraphs: ["AdSpy Pro is an ad and product research platform that shows sellers which products are selling now, the ads behind them, and how the stores selling them are doing."],
      },
      {
        heading: "Press requests",
        paragraphs: ["For interviews, data for an article or brand assets, contact us and mention your publication and deadline."],
      },
    ],
  },
  {
    slug: "partners",
    group: "Company",
    title: "Partners",
    intro: "Work with us if you teach, coach or serve e-commerce sellers.",
    sections: [
      {
        bullets: [
          "Educators and communities: give your students a tool to practise product research with real data.",
          "Agencies: research products and creatives for several clients from one account.",
          "Tools and suppliers: integrations that save sellers a step, for example sourcing or store building.",
        ],
      },
      { paragraphs: ["Tell us who you are and what you have in mind, and we'll get back to you."] },
    ],
  },

  // ── Support ────────────────────────────────────────────────────────────────
  {
    slug: "methodology",
    group: "Support",
    title: "Data & methodology",
    intro: "Where our data comes from, how often it updates, and how scores and estimates are worked out.",
    sections: [
      {
        heading: "Where the data comes from",
        bullets: [
          "Ads: licensed ad-research data providers and Meta's official Ad Library API (EU ads). We don't scrape Facebook, Instagram or TikTok.",
          "Products: the products those ads sell (from their landing pages), plus Amazon, TikTok Shop and Shopify bestseller data.",
          "Stores: Shopify stores' public catalogs (/products.json), read politely: we follow each store's robots.txt and read one page a second.",
          "Supplier costs: AliExpress listings matched by product title, plus a shipping estimate.",
        ],
      },
      {
        heading: "How often it updates",
        paragraphs: [
          "Every morning: new ads are imported, linked to the products they sell, duplicates are merged, stores are checked, every product is scored and Winning Products is rebuilt. Exchange rates come from the European Central Bank daily. How long an ad has run comes from our own record of when we first and last saw it.",
        ],
      },
      {
        heading: "How products are scored",
        paragraphs: [
          "Each product's score has five parts, each from 0 to 100, and you can see them on its page: ad momentum (live ads, how long they've run, how strong they are), estimated revenue, trend (views over the last weeks), competition (fewer different advertisers is better) and margin.",
          "The parts are combined, then ranked against every product we track, so the number means something: a score of 70 beats about 80% of products, 85 is the top 5%, and 90 or more is rare.",
        ],
      },
      {
        heading: "What makes a Winning Product",
        bullets: [
          "A score of 65 or more,",
          "about $10,000 a month or more in estimated revenue,",
          "at least 3 ads running now,",
          "views that aren't falling over 14 days,",
          "and competition that isn't already high.",
        ],
      },
      {
        heading: "Revenue and other estimates",
        paragraphs: [
          "Platforms don't publish revenue or ad spend, so we estimate them and say how sure we are. High confidence: from a marketplace's own sales counts, or when a store's catalog changes and its new reviews agree. Medium: from reported TikTok Shop sales, or one store signal. Low: from ad views with typical click and conversion rates.",
          "We show one figure rather than a wide range. Each month the estimates are checked against stores and products whose real revenue we know, and each method is corrected by how far off it was.",
        ],
      },
      {
        heading: "Competition by country",
        paragraphs: ["Saturation comes from our own ad data: how many different advertisers ran ads for a product in each country over the last 7 days."],
      },
    ],
  },
  {
    slug: "help",
    group: "Support",
    title: "Help Center",
    intro: "Quick answers to the most common questions.",
    sections: [
      {
        heading: "Where does the data come from?",
        paragraphs: ["Ads come from public ad libraries and ad-research data providers (Facebook, Instagram, TikTok). Products come from those ads and from Amazon, TikTok Shop and Shopify bestseller data. Everything is refreshed every morning."],
      },
      {
        heading: "How are revenue and ad spend worked out?",
        paragraphs: ["Platforms don't publish them, so we estimate them from what we can see (sales counts, views, days running, price, catalog changes, reviews) and show one figure with a High, Medium or Low confidence label. See Data & methodology for the details."],
      },
      {
        heading: "How do I find a product to test?",
        bullets: [
          "Open Winning Products for the top picks per niche, refreshed daily.",
          "Use Products with filters such as margin, ads running and growth.",
          "Upload a photo with Search by image to find a product and the ads selling it.",
          "Ask AI, or create an AI Agent that sends you picks every morning.",
        ],
      },
      {
        heading: "How do alerts work?",
        paragraphs: ["Pro (and the 7-day trial) lets you follow advertisers and products: you get an alert when they launch new ads, or when a product's score reaches the number you chose. Alerts show in the app and in your morning email. Everyone can track stores and watch niches under Alerts."],
      },
      {
        heading: "How do I cancel?",
        paragraphs: ["Go to Settings → Plan & billing → Manage billing. You keep access until the end of the period you paid for."],
      },
    ],
  },
  {
    slug: "docs",
    group: "Support",
    title: "Documentation",
    intro: "What each part of AdSpy Pro does and how to use it.",
    sections: [
      { heading: "Dashboard", paragraphs: ["Today's numbers, the best winner, trending products, top niches and everything added in the last day."] },
      { heading: "Winning Products", paragraphs: ["The top products per niche, as a new mix every 3 days from all products with a high enough score: the best always stay, the rest rotate so you see new products. Big brands, print-on-demand and services are left out."] },
      { heading: "Products", paragraphs: ["Every product we track, with filters for niche, source, price, margin, ads running, likes, growth, score, trend and saturation. Open a product for its ads, history charts and estimated revenue."] },
      { heading: "Ad Spy", paragraphs: ["Running ads from Facebook, Instagram and TikTok. Filter by niche, dates, country, format and engagement, play videos right in the grid, download them, and follow advertisers."] },
      { heading: "Hooks of the week", paragraphs: ["Every Monday: the opening lines of the week's most engaging ads per niche, with the hook type, why it works and a template you can reuse."] },
      { heading: "Research", paragraphs: ["Find suppliers for a product and compare prices before you test it."] },
      { heading: "Store Tracker", paragraphs: ["Shopify stores with estimated revenue, traffic and best sellers. Track a store to get daily sales estimates, a sales chart and alerts when it adds products or its sales jump."] },
      { heading: "AI Agents", paragraphs: ["Give an agent a research goal once; every morning it searches the data and writes you a short briefing."] },
      { heading: "Add to Shopify", paragraphs: ["Connect your store once (Admin API token with write_products), then add any product to it as a draft in one click, or download a Shopify CSV."] },
      { heading: "Chrome Extension", paragraphs: ["Save ads you find while browsing straight into AdSpy Pro."] },
    ],
  },
  {
    slug: "community",
    group: "Support",
    title: "Community",
    intro: "Learn with other sellers who use AdSpy Pro.",
    sections: [
      {
        paragraphs: [
          "Our community space is being set up. Until it opens, share feedback and feature ideas with us directly — many features in AdSpy Pro started as a customer request.",
        ],
      },
    ],
  },
  {
    slug: "status",
    group: "Support",
    title: "Status",
    intro: "Live numbers from AdSpy Pro's database and when our data is refreshed.",
    sections: [
      {
        heading: "Daily refresh (UTC)",
        bullets: [
          "06:15–07:45 — new ads and products are imported",
          "08:05 — ads are linked to products and Winning Products is rebuilt",
          "08:35 — follow alerts are sent",
          "09:20 — AI Agents write their briefings",
          "10:05 — tracked stores' sales are checked",
          "Mondays 09:40 — Hooks of the week",
        ],
      },
    ],
  },

  // ── Legal ──────────────────────────────────────────────────────────────────
  {
    slug: "privacy",
    group: "Legal",
    title: "Privacy Policy",
    intro: "What personal data AdSpy Pro collects, why, and what you can do about it.",
    sections: [
      {
        heading: "What we collect",
        bullets: [
          "Account details: your email address, name and, if you sign in with Google, your Google profile picture.",
          "What you do in the app: saved products and ads, tracked stores, followed advertisers, alert settings, AI agents and AI chat requests, so the features work.",
          "Billing: your plan and payment status. Card details are handled by our payment provider and never stored by us.",
          "If you connect a Shopify store: its address and the access token you give us, used only to add products you choose.",
        ],
      },
      {
        heading: "How we use it",
        bullets: [
          "To run your account and the features you use.",
          "To send alerts and emails you have turned on.",
          "To prevent abuse, for example daily limits on AI requests.",
        ],
      },
      {
        heading: "Who we share it with",
        paragraphs: [
          "Only service providers that help us run AdSpy Pro: hosting and database, email delivery, payments, and the AI provider that answers AI requests. We don't sell your data and don't use advertising trackers.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: ["You can change your alert settings at any time, disconnect your Shopify store, and ask us to export or delete your data (see GDPR)."],
      },
      {
        heading: "Ad and product data",
        paragraphs: ["The ads, products and stores in AdSpy Pro are public business information collected from public sources and data providers. They are not personal data about you."],
      },
    ],
  },
  {
    slug: "terms",
    group: "Legal",
    title: "Terms of Service",
    intro: "The rules for using AdSpy Pro. By creating an account you agree to them.",
    sections: [
      {
        heading: "Your account",
        bullets: [
          "Keep your login safe; you're responsible for activity on your account.",
          "One account is for one person.",
          "Don't resell, scrape or bulk-export AdSpy Pro's data, and don't try to break or overload the service.",
        ],
      },
      {
        heading: "Plans and payment",
        bullets: [
          "Paid plans renew automatically until you cancel in Settings → Plan & billing.",
          "When you cancel, you keep access until the end of the period you paid for.",
        ],
      },
      {
        heading: "Our data and estimates",
        paragraphs: [
          "AdSpy Pro shows research data and estimates to help you decide. Revenue, spend, sales and scores are estimates and can be wrong. Decisions about what to sell and how much to spend are yours.",
          "Ads, product photos and videos belong to their owners. Use them for research; don't reuse someone else's creative or brand without permission.",
        ],
      },
      {
        heading: "Availability and changes",
        paragraphs: ["We work to keep AdSpy Pro available and accurate but can't guarantee it will always be. We may change features or these terms; important changes will be announced in the app."],
      },
    ],
  },
  {
    slug: "cookies",
    group: "Legal",
    title: "Cookie Policy",
    intro: "AdSpy Pro uses only the storage it needs to work. No advertising or tracking cookies.",
    sections: [
      {
        heading: "What we store in your browser",
        bullets: [
          "Sign-in: keeps you signed in between visits.",
          "Preferences: light/dark mode, saved searches and which ads you have already viewed.",
          "App updates: lets the app load fast and work after an update.",
        ],
      },
      {
        heading: "What we don't use",
        paragraphs: ["No advertising cookies, no cross-site tracking and no third-party analytics. You can clear this storage any time in your browser settings; you'll then need to sign in again."],
      },
    ],
  },
  {
    slug: "gdpr",
    group: "Legal",
    title: "GDPR",
    intro: "Your rights over your personal data under the EU and UK GDPR.",
    sections: [
      {
        heading: "Your rights",
        bullets: [
          "Access: get a copy of the personal data we hold about you.",
          "Correction: fix data that is wrong.",
          "Deletion: have your account and personal data deleted.",
          "Portability: get your data in a machine-readable format.",
          "Objection: object to processing you don't agree with.",
        ],
      },
      {
        heading: "Why we process your data",
        paragraphs: ["To provide the service you signed up for (contract), to keep it secure (legitimate interest), and to send optional emails only when you turn them on (consent)."],
      },
      {
        heading: "How to make a request",
        paragraphs: ["Contact us from the email address on your account. We reply within 30 days."],
      },
    ],
  },
];

export const pageBySlug = (slug: string) => INFO_PAGES.find((p) => p.slug === slug);
