import { useState } from "react";
import { motion } from "motion/react";
import { Check, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import ProCheckoutDialog from "@/components/billing/ProCheckoutDialog.tsx";
import { PRO_PRICE_EUR, PRO_YEARLY_PER_MONTH_EUR, PRO_YEARLY_TOTAL_EUR, type BillingPeriod } from "@/lib/stripe.ts";

const FREE_LIMIT = 10;

const plans = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Try AdSpy Pro and see how it works.",
    features: [
      `First ${FREE_LIMIT} results of every list`,
      "Ad Spy: Facebook, Instagram and TikTok ads",
      "Winning products and store tracker",
      "Save ads and products",
    ],
    missing: ["Every result, no limits"],
    popular: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: PRO_PRICE_EUR,
    description: "Everything unlocked for serious sellers.",
    features: [
      "Every result in every list, no limits",
      "Full Ad Spy on all platforms",
      "All winning products, stores and trends",
      "AI tools and alerts",
      "Priority support",
    ],
    missing: [],
    popular: true,
  },
];

const buttonClass = (popular: boolean) =>
  cn(
    "w-full mb-6 font-semibold",
    popular ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-secondary text-secondary-foreground hover:bg-muted",
  );

function ProButton({ period }: { period: BillingPeriod }) {
  const { isPro, isLoading } = useUserPlan();
  const [open, setOpen] = useState(false);
  if (isPro) {
    return (
      <Button asChild variant="secondary" className={buttonClass(false)}>
        <Link to="/dashboard">You're on Pro · Open dashboard</Link>
      </Button>
    );
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={isLoading} className={buttonClass(true)}>
        Upgrade to Pro
      </Button>
      <ProCheckoutDialog key={period} open={open} onOpenChange={setOpen} initialPeriod={period} />
    </>
  );
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const period: BillingPeriod = yearly ? "yearly" : "monthly";
  return (
    <section id="pricing" className="py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">Simple pricing</h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Start free with the first {FREE_LIMIT} results of every list. Go Pro to unlock everything: €{PRO_PRICE_EUR} a
            month, or €{PRO_YEARLY_PER_MONTH_EUR} a month paid yearly.
          </p>
          <div className="inline-flex items-center gap-1 bg-card border border-border rounded-full p-1 mt-8">
            {(["monthly", "yearly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setYearly(p === "yearly")}
                className={cn(
                  "px-5 py-2 rounded-full text-sm font-medium transition-all cursor-pointer flex items-center gap-2 capitalize",
                  period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p}
                {p === "yearly" && (
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-bold", yearly ? "bg-primary-foreground/20" : "bg-good/10 text-good")}>
                    Save €{PRO_PRICE_EUR * 12 - PRO_YEARLY_TOTAL_EUR}
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={cn(
                "relative rounded-2xl border p-7 flex flex-col",
                plan.popular ? "border-primary bg-gradient-to-b from-primary/10 to-card shadow-xl shadow-primary/10" : "border-border bg-card",
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
                  <span className="text-4xl font-extrabold">€{plan.id === "pro" && yearly ? PRO_YEARLY_PER_MONTH_EUR : plan.price}</span>
                  <span className="text-muted-foreground text-sm">/month</span>
                </div>
                {plan.id === "pro" && yearly && (
                  <div className="text-xs text-good mt-1">Billed €{PRO_YEARLY_TOTAL_EUR} once a year</div>
                )}
              </div>

              <Authenticated>
                {plan.id === "pro" ? (
                  <ProButton period={period} />
                ) : (
                  <Button asChild className={buttonClass(false)}>
                    <Link to="/dashboard">Open dashboard</Link>
                  </Button>
                )}
              </Authenticated>
              <Unauthenticated>
                <SignInButton
                  className={buttonClass(plan.popular)}
                  signInText={plan.id === "pro" ? "Sign in to upgrade" : "Start free"}
                />
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

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-sm text-muted-foreground mt-8"
        >
          Pro renews automatically each month or year until you turn it off in Settings. Payments by Stripe.
        </motion.p>
      </div>
    </section>
  );
}
