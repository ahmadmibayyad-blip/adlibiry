import { motion } from "motion/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/Logo.tsx";
import { Button } from "@/components/ui/button.tsx";

export default function FinalCTA() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          className="bg-card border border-border rounded-3xl p-12 md:p-16"
        >
          <LogoMark size={36} className="mx-auto mb-6" />
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">
            Start finding winning products today
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10">
            Start free with the first 10 results of every list, or try Pro free for 7 days. No card needed, cancel anytime.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Unauthenticated>
              <Button asChild size="lg" className="h-12 px-8 text-base font-semibold rounded-xl">
                <a href="/#pricing">
                  Start free
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </a>
              </Button>
            </Unauthenticated>
            <Authenticated>
              <Button asChild size="lg" className="h-12 px-8 text-base font-semibold rounded-xl">
                <Link to="/dashboard">
                  Open dashboard
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </Button>
            </Authenticated>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
