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
      "Browse millions of Facebook, TikTok, and Pinterest ads. Filter by spend, engagement, country, and niche to find the hottest creatives.",
    gradient: "from-green-500/20 to-emerald-500/10",
    accent: "text-green-400",
  },
  {
    icon: TrendingUp,
    title: "Product Research",
    description:
      "Discover trending products before they go mainstream. See real-time sales velocity, saturation scores, and profit potential.",
    gradient: "from-blue-500/20 to-cyan-500/10",
    accent: "text-blue-400",
  },
  {
    icon: Store,
    title: "Store Tracker",
    description:
      "Analyze any Shopify store. See their revenue estimates, traffic sources, best-sellers, and ad strategies at a glance.",
    gradient: "from-purple-500/20 to-pink-500/10",
    accent: "text-purple-400",
  },
  {
    icon: BarChart3,
    title: "Ad Spend Analytics",
    description:
      "See exactly how much competitors are spending on ads. Identify scaling brands and emerging niches before they blow up.",
    gradient: "from-orange-500/20 to-yellow-500/10",
    accent: "text-orange-400",
  },
  {
    icon: Globe,
    title: "Market Intelligence",
    description:
      "Explore product trends across 180+ countries. Find untapped markets and understand demand by region.",
    gradient: "from-teal-500/20 to-green-500/10",
    accent: "text-teal-400",
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
    gradient: "from-rose-500/20 to-pink-500/10",
    accent: "text-rose-400",
  },
  {
    icon: Target,
    title: "Competitor Alerts",
    description:
      "Set up real-time alerts when competitors launch new ads or products. Never miss a market move again.",
    gradient: "from-indigo-500/20 to-blue-500/10",
    accent: "text-indigo-400",
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
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-5">
            Everything You Need
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">
            The Complete Ecommerce
            <br />
            <span className="text-primary">Intelligence Suite</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            From ad spy to product research to store analytics — all the tools elite dropshippers and brand builders use in one platform.
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
