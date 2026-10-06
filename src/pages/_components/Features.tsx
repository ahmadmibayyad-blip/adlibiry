import { motion } from "motion/react";
import {
  Search,
  TrendingUp,
  Store,
  BarChart3,
  Globe,
  Sparkles,
  Eye,
  Target,
} from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Ad Spy",
    description:
      "Browse Facebook, Instagram and TikTok ads. Filter by spend, engagement, country and niche to find the creatives that are working.",
    gradient: "from-chart-1/15 to-chart-1/5",
    accent: "text-chart-1",
  },
  {
    icon: TrendingUp,
    title: "Product Research",
    description:
      "Discover trending products before they go mainstream. See real-time sales velocity, saturation scores, and profit potential.",
    gradient: "from-chart-3/15 to-chart-3/5",
    accent: "text-chart-3",
  },
  {
    icon: Store,
    title: "Store Tracker",
    description:
      "Analyze any Shopify store. See their revenue estimates, traffic sources, best-sellers, and ad strategies at a glance.",
    gradient: "from-chart-4/15 to-chart-4/5",
    accent: "text-chart-4",
  },
  {
    icon: BarChart3,
    title: "Ad Spend Analytics",
    description:
      "See exactly how much competitors are spending on ads. Identify scaling brands and emerging niches before they blow up.",
    gradient: "from-brand/15 to-brand/5",
    accent: "text-brand-ink",
  },
  {
    icon: Globe,
    title: "Market Intelligence",
    description:
      "Explore product trends across 180+ countries. Find untapped markets and understand demand by region.",
    gradient: "from-chart-5/15 to-chart-5/5",
    accent: "text-chart-5",
  },
  {
    icon: Sparkles,
    title: "Magic AI",
    description:
      "Our AI engine scores every product and ad, predicts winners, finds your competitors, and gives you actionable insights instantly.",
    gradient: "from-primary/20 to-primary/5",
    accent: "text-primary",
  },
  {
    icon: Eye,
    title: "Creative Library",
    description:
      "Save winning ads to your personal library. Organize by niche, platform, and performance for instant creative inspiration.",
    gradient: "from-chart-2/15 to-chart-2/5",
    accent: "text-chart-2",
  },
  {
    icon: Target,
    title: "Competitor Alerts",
    description:
      "Set up real-time alerts when competitors launch new ads or products. Never miss a market move again.",
    gradient: "from-chart-3/15 to-chart-1/5",
    accent: "text-chart-3",
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
            Ad search, product research, store tracking and AI checks, so you can go from an ad you saw to a product you can sell.
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
