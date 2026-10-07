import { motion } from "motion/react";
import {
  Search,
  TrendingUp,
  ClipboardCheck,
  PackageSearch,
  Store,
  ShoppingBag,
  Quote,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Ad Spy",
    description:
      "Facebook, Instagram and TikTok ads with country, niche and engagement filters. The Scaling filter shows ads running 14+ days that are still growing.",
    gradient: "from-chart-1/15 to-chart-1/5",
    accent: "text-chart-1",
  },
  {
    icon: TrendingUp,
    title: "Winning products",
    description:
      "Products tied to the ads selling them, scored every morning. Every score shows how it was worked out, and revenue comes with a confidence label.",
    gradient: "from-chart-3/15 to-chart-3/5",
    accent: "text-chart-3",
  },
  {
    icon: ClipboardCheck,
    title: "Should I test this?",
    description:
      "One plain verdict per product: demand, room left in your country, margin and angles to learn from. Test, maybe or skip.",
    gradient: "from-brand/15 to-brand/5",
    accent: "text-brand-ink",
  },
  {
    icon: PackageSearch,
    title: "Supplier finder",
    description:
      "The closest AliExpress matches for each product with price, rating and orders, so margins come from real supplier costs.",
    gradient: "from-chart-4/15 to-chart-4/5",
    accent: "text-chart-4",
  },
  {
    icon: Store,
    title: "Store watchlist",
    description:
      "Watch competitor Shopify stores: their catalog, estimated orders and ads. Get alerts for new products, price changes and new ads.",
    gradient: "from-chart-5/15 to-chart-5/5",
    accent: "text-chart-5",
  },
  {
    icon: ShoppingBag,
    title: "TikTok Shop",
    description: "TikTok Shop best-sellers ranked by estimated sales per month, filtered to your niches. Updated daily.",
    gradient: "from-chart-2/15 to-chart-2/5",
    accent: "text-chart-2",
  },
  {
    icon: Quote,
    title: "Hooks and angles",
    description:
      "The opening lines winning ads use, including what's said in the first 3 seconds of videos, and which angles your niche hasn't used yet.",
    gradient: "from-chart-3/15 to-chart-1/5",
    accent: "text-chart-3",
  },
  {
    icon: Sparkles,
    title: "AI tools",
    description:
      "Score a product, find competitors and get hooks and ad copy written from the app's own data. Use it in Claude or ChatGPT too.",
    gradient: "from-primary/20 to-primary/5",
    accent: "text-primary",
  },
];

export default function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">
            Every research tool in one place
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Find it, check it, source it and keep watching it, without five tabs and three other subscriptions.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: (i % 4) * 0.07 }}
                className={`relative group rounded-2xl border border-border bg-gradient-to-br ${feat.gradient} p-6 hover:border-primary/30 transition-all duration-300 cursor-default`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-background/50 ${feat.accent}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base mb-2">{feat.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feat.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
