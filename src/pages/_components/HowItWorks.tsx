import { motion } from "motion/react";
import { Search, BarChart3, Rocket } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Search,
    title: "Discover Winning Ads",
    description:
      "Search our database of 10M+ active ads across Facebook, TikTok, and Pinterest. Use advanced filters — ad spend, engagement rate, country, niche — to pinpoint exactly what's working right now.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    number: "02",
    icon: BarChart3,
    title: "Validate & Analyze",
    description:
      "Dig into any product or store with one click. See real revenue estimates, traffic breakdown, ad spend history, and our proprietary AI score to instantly know if a product is worth pursuing.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    number: "03",
    icon: Rocket,
    title: "Scale with Confidence",
    description:
      "Build your campaign with proven creatives and tested angles. Import products directly, set competitor alerts, and track your market daily to stay ahead of the curve.",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-card/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-5">
            Simple 3-Step Process
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            From Research to
            <span className="text-primary"> Revenue</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Most sellers waste weeks testing random products. WinningHunter cuts that to minutes.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-14 left-[16.67%] right-[16.67%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.15 }}
                  className="flex flex-col items-center text-center"
                >
                  {/* Icon bubble */}
                  <div className={`relative w-28 h-28 rounded-3xl ${step.bg} border border-border flex flex-col items-center justify-center mb-8 shadow-lg`}>
                    <Icon className={`w-8 h-8 ${step.color} mb-1`} />
                    <span className={`text-xs font-bold ${step.color} opacity-60`}>{step.number}</span>
                  </div>
                  <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm">{step.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
