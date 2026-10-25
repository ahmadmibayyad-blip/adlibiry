import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errorMessage.ts";
import { HandCoins } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

// Admin → Users: affiliates and what they're owed (convex/affiliates.ts).
// Pay by hand (PayPal / Wise to the payout email), then press "Mark paid".
const euros = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);

export default function AffiliatesCard() {
  const rows = useQuery(api.affiliates.adminList, {});
  const markPaid = useMutation(api.affiliates.markPaid);
  const voidForPayment = useMutation(api.affiliates.voidForPayment);
  const [refund, setRefund] = useState("");

  async function pay(affiliateId: Id<"affiliates">, label: string, payable: number) {
    if (!window.confirm(`Mark ${euros(payable)} as paid to ${label}? Do this after you've sent the money.`)) return;
    try {
      const r = await markPaid({ affiliateId });
      toast.success(r.count ? `Marked ${euros(r.amount)} paid to ${label}` : "Nothing payable yet");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't mark it paid"));
    }
  }

  async function onVoid() {
    if (!window.confirm(`Cancel the unpaid commission for ${refund.trim()}?`)) return;
    try {
      const done = await voidForPayment({ paymentIntentId: refund.trim() });
      toast[done ? "success" : "error"](done ? "Commission cancelled" : "No unpaid commission for that payment");
      if (done) setRefund("");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't cancel the commission"));
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <HandCoins className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Affiliates</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        30% of referred users' payments for 12 months, payable 30 days after each payment. Send the money to the payout email, then
        mark it paid.
      </p>
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No affiliates yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-3">Code</th>
                <th className="py-1 pr-3">Payout email</th>
                <th className="py-1 pr-3">Clicks / sign-ups / paying</th>
                <th className="py-1 pr-3">On hold</th>
                <th className="py-1 pr-3">Payable</th>
                <th className="py-1 pr-3">Paid</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{r.code}</div>
                    <div className="text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="py-1.5 pr-3">{r.payoutEmail || <span className="text-warn">not set</span>}</td>
                  <td className="py-1.5 pr-3">
                    {r.clicks} / {r.signups} / {r.paying}
                  </td>
                  <td className="py-1.5 pr-3">{euros(r.pending)}</td>
                  <td className="py-1.5 pr-3 font-semibold">{euros(r.payable)}</td>
                  <td className="py-1.5 pr-3">{euros(r.paid)}</td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant="secondary" disabled={r.payable === 0} onClick={() => void pay(r._id, r.code, r.payable)}>
                      Mark paid
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="flex gap-2 mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onVoid();
        }}
      >
        <Input value={refund} onChange={(e) => setRefund(e.target.value)} name="refundPaymentId" autoComplete="off" spellCheck={false} aria-label="Refunded payment ID" placeholder="Refunded payment (pi_…): cancel its commission" />
        <Button type="submit" size="sm" variant="ghost" disabled={!refund.trim()}>
          Cancel commission
        </Button>
      </form>
    </div>
  );
}
