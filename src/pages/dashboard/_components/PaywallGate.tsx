import { Link } from "react-router-dom";
import { Lock, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { motion } from "motion/react";

export default function PaywallGate() {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl font-bold mb-2">Upgrade to Access This Feature</h2>
        <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
          This feature is available on the Pro plan. Upgrade now to unlock unlimited product research, full ad spy, AI scoring, and more.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="w-full">
            <Link to="/#pricing">
              <Zap className="w-4 h-4 mr-2" />
              Upgrade to Pro
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
