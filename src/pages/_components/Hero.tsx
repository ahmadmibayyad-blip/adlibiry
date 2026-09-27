import { motion } from "motion/react";
import { ArrowRight, Play, TrendingUp, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

const badges = [
  { icon: TrendingUp, label: "10M+ Ads Tracked" },
  { icon: ShieldCheck, label: "Trusted by 50K+ Sellers" },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Radial glow background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[80px]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-8"
        >
          <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          Real-time Ad Intelligence Platform
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-balance leading-[1.05] mb-6"
        >
          Find Winning Products
          <br />
          <span className="text-primary">Before Your Competitors</span>
          <br />
          Even Do
        </motion.h1>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-balance"
        >
          The professional ad intelligence platform for serious dropshippers. Spy on real Facebook ads, discover trending products, source from AliExpress, and let AI do the heavy lifting.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-12"
        >
          <Button
            size="lg"
            className="bg-primary text-primary-foreground font-bold px-8 py-6 text-base gap-2 rounded-xl hover:opacity-90 transition-opacity"
          >
            Start Free 7-Day Trial
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="border border-border text-foreground px-8 py-6 text-base gap-2 rounded-xl hover:bg-muted"
          >
            <Play className="w-4 h-4 fill-current" />
            Watch Demo
          </Button>
        </motion.div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex flex-wrap items-center justify-center gap-6 mb-16"
        >
          {badges.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="w-4 h-4 text-primary" />
              {label}
            </div>
          ))}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-yellow-400">★★★★★</span>
            4.9/5 Rating
          </div>
        </motion.div>

        {/* Hero image */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] as const }}
          className="relative mx-auto max-w-5xl"
        >
          <div className="relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl shadow-primary/10">
            {/* Fake browser chrome */}
            <div className="bg-card border-b border-border px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <div className="flex-1 mx-4 bg-muted rounded-md h-6 flex items-center px-3">
                <span className="text-xs text-muted-foreground">app.adspypro.com/dashboard</span>
              </div>
            </div>
            <img
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3NzIwMTN8MHwxfHNlYXJjaHwxfHxlY29tbWVyY2UlMjBwcm9kdWN0JTIwcmVzZWFyY2glMjBkYXNoYm9hcmQlMjBhbmFseXRpY3N8ZW58MHx8fHwxNzkwMTI4MzM5fDA&ixlib=rb-4.1.0&q=80&w=1080"
              alt="Dashboard preview"
              className="w-full object-cover h-[340px] sm:h-[460px]"
            />
            {/* Gradient overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
          </div>
          {/* Glow under */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-primary/20 blur-3xl rounded-full" />
        </motion.div>
      </div>
    </section>
  );
}
