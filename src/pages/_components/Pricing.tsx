import { useState } from "react";
import { motion } from "motion/react";
import { Check, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton } from "@/components/ui/signin.tsx";

const plans = [
  {
    name: "Starter",
    monthlyVariant: "var_starter_monthly",
    yearlyVariant: "var_starter_yearly",
    monthlyPrice: 29,
    yearlyPrice: 166, // 19900 cents / 12 months display
    description: "Perfect for beginners finding their first winning products.",
    features: [
      "50 products discovered / day",
      "Basic ad spy (Facebook EU/UK)",
      "5 competitor store trackers",
      "Google Trends access",
      "AliExpress sourcing",
      "Profit margin calculator",
    ],
    missing: ["AI product scoring", "Unlimited searches", "Real-time alerts"],
    cta: "Start Free Trial",
    popular: false,
    featureId: "feat_starter",
  },
  {
    name: "Pro",
    monthlyVariant: "var_pro_monthly",
    yearlyVariant: "var_pro_yearly",
    monthlyPrice: 79,
    yearlyPrice: 569,
    description: "For serious sellers scaling to 6 figures and beyond.",
    features: [
      "Unlimited product research",
      "Full ad spy — all platforms",
      "Unlimited store trackers",
      "AI product scoring (0–100)",
      "AI ad angle generator",
      "Real-time competitor alerts",
      "Creative library (save ads)",
      "Saturation score per product",
      "Priority support",
    ],
    missing: [],
    cta: "Start Free Trial",
    popular: true,
    featureId: "feat_pro",
  },
  {
    name: "Agency",
    monthlyVariant: "var_agency_monthly",
    yearlyVariant: "var_agency_yearly",
    monthlyPrice: 199,
    yearlyPrice: 1439,
    description: "For teams and agencies managing multiple brands.",
    features: [
      "Everything in Pro",
      "5 team member seats",
      "White-label reports",
      "API access",
      "Dedicated account manager",
      "Custom alerts & integrations",
      "Bulk product export",
    ],
    missing: [],
    cta: "Start Free Trial",
    popular: false,
    featureId: "feat_agency",
  },
];

function PlanButton({ variantId, cta, popular }: { variantId: string; cta: string; popular: boolean }) {
  const createCheckout = useAction(api.commerce.createCheckout);
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const result = await createCheckout({
        variantId,
        successUrl: window.location.origin + "/dashboard",
        cancelUrl: window.location.href,
      });
      if (result.url) window.open(result.url, "_blank");
    } catch {
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleCheckout}
      disabled={loading}
      className={cn(
        "w-full mb-6 font-semibold",
        popular
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "bg-secondary text-secondary-foreground hover:bg-muted"
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
      {cta}
    </Button>
  );
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-5">
            Simple, Transparent Pricing
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            No Hidden Fees.
            <span className="text-primary"> Cancel Anytime.</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
            7-day free trial on all plans. No credit card required to start. See exactly what you get before paying.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 bg-card border border-border rounded-full p-1">
            <button
              onClick={() => setYearly(false)}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all cursor-pointer",
                !yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-all cursor-pointer flex items-center gap-2",
                yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-bold", yearly ? "bg-primary-foreground/20 text-primary-foreground" : "bg-good/10 text-good")}>
                -40%
              </span>
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={cn(
                "relative rounded-2xl border p-7 flex flex-col",
                plan.popular
                  ? "border-primary bg-gradient-to-b from-primary/10 to-card shadow-xl shadow-primary/10"
                  : "border-border bg-card"
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-bold px-4 py-1.5 rounded-full">
                    <Zap className="w-3 h-3" />
                    Most Popular
                  </div>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold">
                    ${yearly ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice}
                  </span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                {yearly && (
                  <div className="text-xs text-good mt-1">
                    Billed ${plan.yearlyPrice}/year · Save ${(plan.monthlyPrice * 12) - plan.yearlyPrice}/yr
                  </div>
                )}
              </div>

              <Authenticated>
                <PlanButton
                  variantId={yearly ? plan.yearlyVariant : plan.monthlyVariant}
                  cta={plan.cta}
                  popular={plan.popular}
                />
              </Authenticated>
              <Unauthenticated>
                <SignInButton
                  className={cn(
                    "w-full mb-6 font-semibold",
                    plan.popular
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "bg-secondary text-secondary-foreground hover:bg-muted"
                  )}
                >
                  Sign In to Start
                </SignInButton>
              </Unauthenticated>

              <ul className="space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
                {plan.missing.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm opacity-40">
                    <span className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-muted-foreground">—</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Trust note */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-sm text-muted-foreground mt-8"
        >
          All plans renew automatically. Cancel before renewal to avoid charges. Renewal date always visible in your dashboard.
        </motion.p>
      </div>
    </section>
  );
}
