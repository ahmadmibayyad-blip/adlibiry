import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";

// After a payment that needed a redirect (bank app, 3-D Secure), Stripe sends
// the customer back with ?payment_intent=pi_…; finish the upgrade once.
export default function ProReturnHandler() {
  const [params, setParams] = useSearchParams();
  const confirmProPayment = useAction(api.proPlan.confirmProPayment);
  const done = useRef(false);
  const paymentIntentId = params.get("payment_intent");
  const period = params.get("pro_period") === "yearly" ? "yearly" : "monthly";

  useEffect(() => {
    if (!paymentIntentId || done.current) return;
    done.current = true;
    const next = new URLSearchParams(params);
    for (const k of ["payment_intent", "payment_intent_client_secret", "redirect_status", "pro_period"]) next.delete(k);
    setParams(next, { replace: true });
    confirmProPayment({ paymentIntentId, period })
      .then(() => toast.success("You're on Pro. Every result is unlocked."))
      .catch((err) =>
        toast.error(
          err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? "Couldn't finish the upgrade.") : "Couldn't finish the upgrade.",
        ),
      );
  }, [paymentIntentId, period, params, setParams, confirmProPayment]);

  return null;
}
