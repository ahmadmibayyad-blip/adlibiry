import { useId, useState } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { euros } from "@/lib/money.ts";
import { PRO_PRICE_EUR } from "@/lib/stripe.ts";

// Same terms as convex/affiliates.ts and the /partners page: 30% of each payment, for a member's first 12 months.
const SHARE = 0.3;
const MAX_REFERRALS = 10000;

export default function Affiliate() {
  const inputId = useId();
  // Text state so the field can be emptied while typing.
  const [text, setText] = useState("10");
  const referrals = Math.min(MAX_REFERRALS, Math.max(0, Math.floor(Number(text) || 0)));
  const monthly = referrals * PRO_PRICE_EUR * SHARE;

  return (
    <section id="affiliate" className="py-24" aria-labelledby="affiliate-title">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-4">Affiliate program</p>
          <h2 id="affiliate-title" className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-balance mb-5">
            Earn 30% of every payment for 12 months
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mb-8 text-pretty">
            Recommend AdSpy Pro to your e-commerce audience. You get 30% of every payment from each person you bring, for their first 12
            months, paid monthly to your PayPal or Wise.
          </p>
          <JoinButton />
        </div>

        <div className="rounded-3xl border border-border bg-card p-8 sm:p-10 text-center">
          <h3 className="font-display text-xl font-bold mb-6">Your potential earnings</h3>
          <label htmlFor={inputId} className="block text-sm text-muted-foreground mb-2">
            Pro members you bring
          </label>
          <div className="relative max-w-60 mx-auto">
            <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="w-full h-14 rounded-xl border border-border bg-background pl-11 pr-4 text-center text-xl font-bold tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-6">You earn every month</p>
          <p className="font-display text-5xl font-extrabold text-good tabular-nums my-2" aria-live="polite">
            {euros(monthly)}
          </p>
          <p className="text-xs text-muted-foreground mb-8">
            Pro at {euros(PRO_PRICE_EUR)} a month × 30%, for each member's first 12 months
          </p>
          <JoinButton wide />
        </div>
      </div>
    </section>
  );
}

function JoinButton({ wide = false }: { wide?: boolean }) {
  const className = `h-12 px-8 text-base font-semibold rounded-xl${wide ? " w-full" : ""}`;
  return (
    <>
      {/* Signed out: create an account first, then Settings → Affiliate program (the /partners page says so). */}
      <Unauthenticated>
        <Button asChild size="lg" variant={wide ? "secondary" : "default"} className={className}>
          <Link to="/login">
            Join the program
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </Button>
      </Unauthenticated>
      <Authenticated>
        <Button asChild size="lg" variant={wide ? "secondary" : "default"} className={className}>
          <Link to="/dashboard/settings#affiliate">
            Get your link
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </Button>
      </Authenticated>
    </>
  );
}
