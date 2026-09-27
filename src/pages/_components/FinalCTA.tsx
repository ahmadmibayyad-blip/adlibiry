import { motion } from "motion/react";
import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

export default function FinalCTA() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] rounded-full bg-primary/12 blur-[120px]" />
      </div>
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="bg-gradient-to-b from-card to-background border border-border rounded-3xl p-12 md:p-16"
        >
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mx-auto mb-6">
            <Zap className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">
            Start Finding Winning
            <br />
            <span className="text-primary">Products Today</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10">
            Join 50,000+ dropshippers using AdSpy Pro to discover profitable products and outsmart the competition. 7-day free trial. No credit card needed. Cancel anytime in one click.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="bg-primary text-primary-foreground font-bold px-10 py-6 text-base gap-2 rounded-xl hover:opacity-90"
            >
              Start Free Trial
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="border border-border px-10 py-6 text-base rounded-xl hover:bg-muted"
            >
              View Pricing
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-6">
            No credit card required · Cancel anytime · 7-day free trial
          </p>
        </motion.div>
      </div>
    </section>
  );
}
