import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { countAngles, verdict } from "@/convex/lib/verdict.ts";
import { cn } from "@/lib/utils.ts";

const CALL_STYLE = {
  test: "border-good/40 bg-good/10",
  maybe: "border-warn/40 bg-warn/10",
  skip: "border-bad/40 bg-bad/10",
} as const;
const CALL_TITLE = { test: "Test it", maybe: "Take a closer look", skip: "Skip for now" } as const;

// "Should I test this?" (convex/lib/verdict.ts): demand, room left in the
// user's country, margin and angle bank, with one plain verdict line.
export default function VerdictPanel({ product }: { product: Doc<"products"> }) {
  const ads = useQuery(api.history.productAds, product.linkedAds ? { productId: product._id } : "skip");
  const mine = useQuery(api.onboarding.mine, {});
  const track = useMutation(api.events.track);
  useEffect(() => {
    track({ type: "verdict_view", productId: product._id }).catch(() => {});
  }, [product._id, track]);

  const v = verdict({
    ...product,
    angleCount: countAngles((ads ?? []).map((a) => a.headline)),
    targetCountry: mine?.targetCountry ?? undefined,
  });
  return (
    <div className={cn("rounded-xl border p-4", CALL_STYLE[v.call])}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="font-semibold text-sm">Should I test this?</h3>
        <span className="text-xs font-semibold">{CALL_TITLE[v.call]}</span>
      </div>
      <p className="text-sm mb-3">{v.line}</p>
      <ul className="space-y-1.5">
        {v.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-xs">
            {c.ok === true ? (
              <CheckCircle2 className="w-4 h-4 text-good shrink-0" aria-label="Yes" />
            ) : c.ok === false ? (
              <XCircle className="w-4 h-4 text-bad shrink-0" aria-label="No" />
            ) : (
              <CircleHelp className="w-4 h-4 text-muted-foreground shrink-0" aria-label="Unknown" />
            )}
            <span>
              <strong>{c.label}:</strong> {c.detail}
            </span>
          </li>
        ))}
      </ul>
      {mine && !mine.targetCountry && (
        <p className="text-[11px] text-muted-foreground mt-3">
          <Link to="/dashboard/settings" className="underline">Set the country you sell to</Link> to check competition in your market.
        </p>
      )}
    </div>
  );
}
