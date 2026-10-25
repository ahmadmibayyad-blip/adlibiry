import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Copy, HandCoins } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { REFERRAL_DAYS } from "@/lib/referral.ts";

// Settings → Affiliate program (convex/affiliates.ts). Commissions are in the
// payment's currency (EUR), not the display currency: that's what gets paid out.
const SITE = "https://adspypro.net";

const euros = (cents: number, currency = "eur") =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

const errorText = (e: unknown, fallback: string) =>
  e instanceof ConvexError ? ((e.data as { message?: string }).message ?? fallback) : fallback;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export default function AffiliateSection() {
  const me = useQuery(api.affiliates.mine, {});
  const join = useMutation(api.affiliates.join);
  const setPayoutEmail = useMutation(api.affiliates.setPayoutEmail);
  const [code, setCode] = useState("");
  // null = not edited: show the saved email.
  const [draft, setDraft] = useState<string | null>(null);
  const email = draft ?? me?.payoutEmail ?? "";
  const [busy, setBusy] = useState(false);

  const link = me ? `${SITE}/r/${me.code}` : "";

  async function onJoin() {
    setBusy(true);
    try {
      await join(code.trim() ? { code } : {});
      toast.success("You're in. Share your link to start earning.");
    } catch (e) {
      toast.error(errorText(e, "Couldn't join. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEmail() {
    setBusy(true);
    try {
      await setPayoutEmail({ email });
      setDraft(null);
      toast.success("Payout email saved");
    } catch (e) {
      toast.error(errorText(e, "Couldn't save the email."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5" id="affiliate">
      <div className="flex items-center gap-2 mb-1">
        <HandCoins className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Affiliate program</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Earn 30% of every payment from people you bring to AdSpy Pro, for their first 12 months. Your link remembers a visitor for{" "}
        {REFERRAL_DAYS} days. Commissions can be paid out 30 days after each payment; we pay monthly to your PayPal or Wise email.
      </p>

      {me === undefined ? null : me === null ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onJoin();
          }}
        >
          <Input
            name="affiliate-code"
            aria-label="Your affiliate code (optional)"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 24))}
            placeholder="Your code, e.g. yourname (optional)"
            disabled={busy}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Joining…" : "Get my link"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Your link</div>
            <div className="flex gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs">{link}</code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label="Copy link"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(link)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Couldn't copy. Select the link and copy it by hand."))
                }
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Clicks" value={me.clicks} />
            <Stat label="Sign-ups" value={me.signups} />
            <Stat label="Paying" value={me.paying} />
            <Stat label="On hold (30 days)" value={euros(me.pending)} />
            <Stat label="Ready to pay out" value={euros(me.payable)} />
            <Stat label="Paid to you" value={euros(me.paid)} />
          </div>

          {me.recent.length > 0 && (
            <ul className="text-xs divide-y divide-border rounded-lg border border-border">
              {me.recent.map((r, i) => (
                <li key={i} className="flex justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">{new Date(r.at).toLocaleDateString()}</span>
                  <span>
                    {euros(r.amount, r.currency)} · {r.status === "pending" ? "on hold" : r.status === "payable" ? "ready" : r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onSaveEmail();
            }}
          >
            <Input
              type="email"
              name="payout-email"
              aria-label="Payout email (PayPal or Wise)"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setDraft(e.target.value.slice(0, 120))}
              placeholder="PayPal or Wise email for payouts"
              disabled={busy}
            />
            <Button type="submit" variant="secondary" disabled={busy || email === me.payoutEmail}>
              Save
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
