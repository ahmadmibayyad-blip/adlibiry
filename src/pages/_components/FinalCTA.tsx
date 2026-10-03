import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/Logo.tsx";
import { Button } from "@/components/ui/button.tsx";

export default function FinalCTA() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="bg-card border border-border rounded-3xl p-12 md:p-16"
        >
          <LogoMark size={36} className="mx-auto mb-6" />
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">
            Start finding winning products today
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10">
            Try every feature free for 7 days, then pick the plan that fits. Cancel anytime in one click.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="h-12 px-8 text-base font-semibold rounded-xl">
              <a href="/#pricing">
                Start your 7-day free trial
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
