import { motion } from "motion/react";
import { Search, ClipboardCheck, PackageSearch, Bell } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Search,
    title: "Discover",
    description:
      "Every morning: winning products tied to the Facebook, Instagram and TikTok ads selling them, plus TikTok Shop best-sellers. Filter for ads that are scaling right now.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    number: "02",
    icon: ClipboardCheck,
    title: "Validate",
    description:
      "“Should I test this?” gives a plain answer: is demand real, is there room left in your country, is the margin there, and are there angles to learn from.",
    color: "text-chart-3",
    bg: "bg-chart-3/10",
  },
  {
    number: "03",
    icon: PackageSearch,
    title: "Source",
    description:
      "See the closest AliExpress suppliers with price, rating and orders. Your margin is worked out from the real supplier cost, not a guess.",
    color: "text-chart-4",
    bg: "bg-chart-4/10",
  },
  {
    number: "04",
    icon: Bell,
    title: "Watch",
    description:
      "Watch competitor stores and get told when they add products, change prices or launch new ads, so you know when to scale or move on.",
    color: "text-chart-5",
    bg: "bg-chart-5/10",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-card/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          className="max-w-2xl mb-12"
        >
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            From an ad you saw to a test you can run
          </h2>
          <p className="text-muted-foreground text-lg">
            Most sellers spend weeks testing random products. AdSpy Pro takes you from a product that's already selling to a sourced,
            costed test decision, in one app.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-14 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.number}
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
