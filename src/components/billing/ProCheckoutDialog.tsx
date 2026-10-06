import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import {
  PRO_PRICE_EUR,
  PRO_RETURN_PATH,
  PRO_YEARLY_PER_MONTH_EUR,
  PRO_YEARLY_TOTAL_EUR,
  getStripe,
  proCharge,
  type BillingPeriod,
} from "@/lib/stripe.ts";

const message = (err: unknown, fallback: string) =>
  err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? fallback) : fallback;

// Upgrade to Pro: the server asks the AdSpy Pro backend for the payment
// (€35 monthly or €360 yearly), the customer pays here with Stripe, then the
// server checks the payment with Stripe and switches Pro on (convex/proPlan.ts).
export default function ProCheckoutDialog({
  open,
  onOpenChange,
  initialPeriod = "monthly",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPeriod?: BillingPeriod;
}) {
  const createProPayment = useAction(api.proPlan.createProPayment);
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod);
  // One payment per period, so switching back and forth doesn't create more.
  const [secrets, setSecrets] = useState<Partial<Record<BillingPeriod, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<BillingPeriod, string>>>({});
  const [autoRenew, setAutoRenew] = useState(true);
  const clientSecret = secrets[period];
  const error = errors[period];

  useEffect(() => {
    if (!open || clientSecret || error) return;
    let cancelled = false;
    // The card is kept for renewals; whether it renews is the checkbox below.
    createProPayment({ period, autoRenew: true })
      .then((r) => !cancelled && setSecrets((s) => ({ ...s, [period]: r.clientSecret })))
      .catch((err) => !cancelled && setErrors((e) => ({ ...e, [period]: message(err, "Couldn't start the payment. Please try again.") })));
    return () => {
      cancelled = true;
    };
  }, [open, period, clientSecret, error, createProPayment]);

  const close = (o: boolean) => {
    onOpenChange(o);
    // Reopening tries again.
    if (!o) setErrors({});
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade to Pro</DialogTitle>
          <DialogDescription>Every result, no limits.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Billing period">
          {(
            [
              ["monthly", `€${PRO_PRICE_EUR}`, "per month"],
              ["yearly", `€${PRO_YEARLY_PER_MONTH_EUR}/mo`, `€${PRO_YEARLY_TOTAL_EUR} billed yearly`],
            ] as const
          ).map(([p, price, note]) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                period === p ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
              )}
            >
              <div className="text-xs text-muted-foreground capitalize">{p}</div>
              <div className="font-bold">{price}</div>
              <div className="text-[11px] text-muted-foreground">{note}</div>
            </button>
          ))}
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 accent-[hsl(var(--primary))]"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
          />
          <span>
            Renew automatically: €{proCharge(period)} every {period === "yearly" ? "year" : "month"} until you turn it off in
            Settings.
          </span>
        </label>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !clientSecret ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Preparing secure payment…
          </div>
        ) : (
          <Elements key={clientSecret} stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <PayForm period={period} autoRenew={autoRenew} onDone={() => close(false)} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ period, autoRenew, onDone }: { period: BillingPeriod; autoRenew: boolean; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmProPayment = useAction(api.proPlan.confirmProPayment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}${PRO_RETURN_PATH}?pro_period=${period}&pro_renew=${autoRenew ? 1 : 0}` },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "The payment didn't go through.");
        return;
      }
      await confirmProPayment({ paymentIntentId: result.paymentIntent.id, period, autoRenew });
      toast.success("You're on Pro. Every result is unlocked.");
      onDone();
    } catch (err) {
      setError(message(err, "Couldn't finish the upgrade. If you were charged, contact support."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
        Pay €{proCharge(period)}
        {period === "yearly" ? " for a year" : " for a month"}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">Payments are processed securely by Stripe.</p>
    </form>
  );
}
