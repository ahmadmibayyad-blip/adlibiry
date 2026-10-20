import { Suspense, lazy, useState } from "react";
import { motion } from "motion/react";
import { Check, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { Authenticated, Unauthenticated, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { SignInButton } from "@/components/ui/signin.tsx";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import { PRO_PRICE_EUR, PRO_YEARLY_PER_MONTH_EUR, PRO_YEARLY_TOTAL_EUR, type BillingPeriod } from "@/lib/stripe.ts";

const ProCheckoutDialog = lazy(() => import("@/components/billing/ProCheckoutDialog.tsx"));

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
      "Should I test this? verdicts and supplier matches",
      "Watch up to 5 competitor stores",
      "Save ads and products",
    ],
    missing: ["Every result, no limits", "Launch to Shopify"],
    popular: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: PRO_PRICE_EUR,
    description: "Everything unlocked for serious sellers. Try it free for 7 days, no card needed.",
    features: [
      "Every result in every list, no limits",
      "Launch 5 products to your Shopify store, 3 of them as full stores",
      "Full Ad Spy on all platforms",
      "All winning products, stores and trends",
      "Should I test this? verdicts and supplier matches",
      "Watch up to 50 competitor stores",
      "AI tools, alerts and the API",
      "Priority support",
    ],
    missing: [],
    // The free trial (convex/lib/billing.ts tierOf; limits next to each feature).
    trialNote:
      "The 7-day free trial has every research tool with smaller daily limits: 10 AI requests, 5 offer searches, 20 store inspections and 10 watched stores. Launch opens when you subscribe.",
    popular: true,
  },
];

const buttonClass = (popular: boolean) =>
  cn(
    "w-full h-11 mb-6 font-semibold",
    popular ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-secondary text-secondary-foreground hover:bg-muted",
  );

const daysLeft = (endsAt: number) => Math.max(1, Math.ceil((endsAt - Date.now()) / 86_400_000));

function ProButton({ period }: { period: BillingPeriod }) {
  const { isPro, isLoading } = useUserPlan();
  const trial = useQuery(api.billing.myTrial, {});
  const startTrial = useMutation(api.billing.startProTrial);
  const [open, setOpen] = useState(false);
  // The checkout's code (Stripe) downloads on the first click; it stays mounted after that so closing animates.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  const checkout = used ? (
    <Suspense fallback={null}>
      <ProCheckoutDialog key={period} open={open} onOpenChange={setOpen} initialPeriod={period} />
    </Suspense>
  ) : null;
  if (trial?.state === "available") {
    return (
      <>
        <Button
          className={buttonClass(true)}
          onClick={async () => {
            try {
              await startTrial({});
              toast.success("Your 7-day Pro trial has started");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not start the trial");
            }
          }}
        >
          Start 7-day free trial
        </Button>
        <button type="button" onClick={() => setOpen(true)} className="-mt-4 mb-6 text-xs text-muted-foreground hover:text-foreground underline">
          or upgrade now
        </button>
        {checkout}
      </>
    );
  }
  if (trial?.state === "active" && trial.endsAt) {
    return (
      <>
        <Button onClick={() => setOpen(true)} className={buttonClass(true)}>
          Pro trial: {daysLeft(trial.endsAt)} day{daysLeft(trial.endsAt) === 1 ? "" : "s"} left · Upgrade
        </Button>
        {checkout}
      </>
    );
  }
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
      {checkout}
    </>
  );
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const period: BillingPeriod = yearly ? "yearly" : "monthly";
  return (
    <section id="pricing" className="py-24">
      {/* Wide screens: the intro on the left, the two plans beside it, instead of two cards and an empty third. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,46rem)] lg:gap-12 lg:items-start">
        <motion.div
          className="max-w-2xl mb-12 lg:mb-0"
        >
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5 text-balance">Simple pricing</h2>
          <p className="text-muted-foreground text-lg">
            Start free with the first {FREE_LIMIT} results of every list. Go Pro to unlock everything: €{PRO_PRICE_EUR} a
            month, or €{PRO_YEARLY_PER_MONTH_EUR} a month paid yearly. Try Pro's research tools free for 7 days, no card needed.
          </p>
          <div className="inline-flex items-center gap-1 bg-card border border-border rounded-full p-1 mt-8">
            {(["monthly", "yearly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setYearly(p === "yearly")}
                className={cn(
                  "min-h-11 px-5 rounded-full text-sm font-medium transition-all cursor-pointer flex items-center gap-2 capitalize",
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.id}
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
                  signInText={plan.id === "pro" ? "Start 7-day free trial" : "Start free"}
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
              {"trialNote" in plan && plan.trialNote && (
                <p className="mt-6 rounded-xl border border-border bg-background/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                  {plan.trialNote}
                </p>
              )}
            </motion.div>
          ))}
        </div>

        <motion.p
          className="text-center text-sm text-muted-foreground mt-8 lg:col-span-2"
        >
          Pro renews automatically each month or year until you turn it off in Settings. Payments by Stripe.{" "}
          <Link to="/methodology" className="text-primary hover:underline">
            How our data and scores work
          </Link>
        </motion.p>
      </div>
    </section>
  );
}
