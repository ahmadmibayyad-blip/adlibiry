import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { PRO_PRICE_EUR, PRO_RETURN_PATH, getStripe } from "@/lib/stripe.ts";

const message = (err: unknown, fallback: string) =>
  err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? fallback) : fallback;

// Upgrade to Pro: the server asks the AdSpy Pro backend for a €35 payment,
// the customer pays here with Stripe, then the server checks the payment with
// Stripe and switches Pro on (convex/proPlan.ts).
export default function ProCheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createProPayment = useAction(api.proPlan.createProPayment);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || clientSecret) return;
    let cancelled = false;
    createProPayment({})
      .then((r) => !cancelled && setClientSecret(r.clientSecret))
      .catch((err) => !cancelled && setError(message(err, "Couldn't start the payment. Please try again.")));
    return () => {
      cancelled = true;
    };
  }, [open, clientSecret, createProPayment]);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade to Pro</DialogTitle>
          <DialogDescription>€{PRO_PRICE_EUR} for one month of Pro: every result, no limits.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !clientSecret ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Preparing secure payment…
          </div>
        ) : (
          <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <PayForm onDone={() => close(false)} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ onDone }: { onDone: () => void }) {
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
        confirmParams: { return_url: window.location.origin + PRO_RETURN_PATH },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "The payment didn't go through.");
        return;
      }
      await confirmProPayment({ paymentIntentId: result.paymentIntent.id });
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
        Pay €{PRO_PRICE_EUR}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">Payments are processed securely by Stripe.</p>
    </form>
  );
}
