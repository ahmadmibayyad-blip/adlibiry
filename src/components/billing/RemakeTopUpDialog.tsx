import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { getStripe } from "@/lib/stripe.ts";
import { euros } from "@/lib/money.ts";

const message = (err: unknown, fallback: string) =>
  err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? fallback) : fallback;

// Extra AI-video seconds for "Make the video": the server creates the payment
// (convex/remakeTopUp.ts), the customer pays here with Stripe, then the server
// checks it with Stripe and adds the seconds.
export default function RemakeTopUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useAction(api.remakeTopUp.create);
  const [payment, setPayment] = useState<{ clientSecret: string; seconds: number; cents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || payment || error) return;
    let cancelled = false;
    create({})
      .then((p) => !cancelled && setPayment(p))
      .catch((err) => !cancelled && setError(message(err, "Couldn't start the payment. Please try again.")));
    return () => {
      cancelled = true;
    };
  }, [open, payment, error, create]);

  const close = (o: boolean) => {
    onOpenChange(o);
    // Reopening starts a fresh payment.
    if (!o) {
      setError(null);
      setPayment(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buy {payment?.seconds ?? 30} more seconds</DialogTitle>
          <DialogDescription>Extra AI-video seconds. They don't expire and are used after this month's.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : !payment ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Preparing secure payment…
          </div>
        ) : (
          <Elements key={payment.clientSecret} stripe={getStripe()} options={{ clientSecret: payment.clientSecret, appearance: { theme: "stripe" } }}>
            <PayForm cents={payment.cents} onDone={() => close(false)} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ cents, onDone }: { cents: number; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const confirm = useAction(api.remakeTopUp.confirm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      // The payment allows no redirect methods, so this returns here.
      const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href }, redirect: "if_required" });
      if (result.error) {
        setError(result.error.message ?? "The payment didn't go through.");
        return;
      }
      const { seconds } = await confirm({ paymentIntentId: result.paymentIntent.id });
      toast.success(`${seconds} seconds added`);
      onDone();
    } catch (err) {
      setError(message(err, "Couldn't add the seconds. If you were charged, contact support."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
        Pay {euros(cents / 100)}
      </Button>
      <p className="text-xs text-muted-foreground text-center">Payments are processed securely by Stripe.</p>
    </form>
  );
}
