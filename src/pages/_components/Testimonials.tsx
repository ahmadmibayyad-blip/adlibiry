import { motion } from "motion/react";

const testimonials = [
  {
    name: "Marcus T.",
    role: "7-Figure Dropshipper",
    avatar: "MT",
    color: "bg-green-500",
    text: "AdSpy Pro completely changed my research workflow. I found a product doing $40K/month in my first week. The AI scoring is insanely accurate.",
    revenue: "+$148K",
  },
  {
    name: "Sarah K.",
    role: "DTC Brand Owner",
    avatar: "SK",
    color: "bg-blue-500",
    text: "The ad spy tool is on another level. I can see exactly what creatives competitors are running and how much they're spending. Pure gold for any serious seller.",
    revenue: "+$92K",
  },
  {
    name: "Jake L.",
    role: "Facebook Ads Agency",
    avatar: "JL",
    color: "bg-purple-500",
    text: "I use WinningHunter for every client. The store tracker saves me 10 hours a week on competitive research alone. Best investment I've made this year.",
    revenue: "+$210K",
  },
  {
    name: "Priya M.",
    role: "TikTok Shop Seller",
    avatar: "PM",
    color: "bg-orange-500",
    text: "Found 3 trending products before they exploded on TikTok. The trend alerts are a game-changer. My store went from $5K to $50K/month in 6 weeks.",
    revenue: "+$55K",
  },
  {
    name: "Chen W.",
    role: "Amazon FBA + Shopify",
    avatar: "CW",
    color: "bg-teal-500",
    text: "The market intelligence data for different countries helped me find a completely untapped market. Now doing €30K/month in Germany alone.",
    revenue: "+$78K",
  },
  {
    name: "Alex R.",
    role: "Serial Ecommerce Entrepreneur",
    avatar: "AR",
    color: "bg-rose-500",
    text: "I've tried every ad spy tool out there. AdSpy Pro is the only one with accurate spend data and a genuinely useful AI. Worth every penny.",
    revenue: "+$320K",
  },
];

export default function Testimonials() {
  return (
    <section className="py-24 bg-card/20 overflow-hidden">
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
            Success Stories
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Sellers Are Winning
            <span className="text-primary"> Every Day</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Join 50,000+ dropshippers using AdSpy Pro to discover profitable products, analyze markets, and scale fast.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
              className="bg-card border border-border rounded-2xl p-6 hover:border-primary/20 transition-colors cursor-default"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-white font-bold text-sm`}>
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
                <div className="text-sm font-bold text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-2 py-1">
                  {t.revenue}
                </div>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                {`"`}{t.text}{`"`}
              </div>
              <div className="mt-4 text-yellow-400 text-sm">★★★★★</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
