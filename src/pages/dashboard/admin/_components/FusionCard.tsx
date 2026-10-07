import { useMutation, useQuery } from "convex/react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";

const TRIGGERS: Record<string, string> = {
  winner: "New winners → advertiser's ads (Apify)",
  spike: "Niche spikes → newcomers (Apify)",
  backfill: "Marketplace products → ads (AdLibrary or Meta API)",
  twin: "Ad-only products → Amazon twin by image (Nexscope)",
  wholesale: "Winners → 1688 suppliers by image (Nexscope)",
  daily: "Daily keyword imports (Apify)",
};
const FIELDS: Record<string, string> = {
  live: "Live or stopped",
  advertiser: "Advertiser name",
  engagement_vs_age: "Engagement too high for the ad's age",
};

// Multi-source fusion (convex/fusion.ts): Apify spend per trigger against the
// daily budget, what the last run did, and source disagreements to sample.
export default function FusionCard() {
  const data = useQuery(api.fusion.adminSummary, {});
  const conflicts = useQuery(api.sourceConflicts.review, {});
  const markReviewed = useMutation(api.sourceConflicts.markReviewed);
  if (!data) return null;
  const last = data.lastRun;
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <GitMerge className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Source fusion</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Apify, Meta's Ad Library, AdLibrary and Nexscope combined per product. Triggered Apify runs share a daily budget of $
        {data.budget.toFixed(2)} (APIFY_DAILY_BUDGET_USD).
      </p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Triggered spend today</div>
          <div className="text-lg font-semibold tabular-nums">${data.spentToday.toFixed(2)}</div>
        </div>
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Verified winners</div>
          <div className="text-lg font-semibold tabular-nums">
            {data.verified} <span className="text-xs text-muted-foreground font-normal">of {data.winners}</span>
          </div>
        </div>
        <div className="bg-muted/60 rounded-lg px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Winners with 2+ sources</div>
          <div className="text-lg font-semibold tabular-nums">{data.multiSource}</div>
        </div>
      </div>

      <h4 className="text-xs font-semibold mb-1.5">Apify spend, last 7 days</h4>
      {data.spend.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-4">No Apify runs yet.</p>
      ) : (
        <ul className="text-xs divide-y divide-border mb-4">
          {data.spend.map((s) => (
            <li key={s.trigger} className="flex justify-between py-1">
              <span>{TRIGGERS[s.trigger] ?? s.trigger}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.runs} run{s.runs === 1 ? "" : "s"} · ${s.usd.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {last && (
        <>
          <h4 className="text-xs font-semibold mb-1.5">Last run ({last.day})</h4>
          <ul className="text-xs space-y-1 mb-4">
            {(["winner", "spike", "backfill", "twin", "wholesale"] as const).map((k) => {
              const r = last[k];
              if (!r) return null;
              return (
                <li key={k}>
                  <span className="font-medium">{TRIGGERS[k]}:</span> {r.done} done
                  {r.skipped ? <span className="text-muted-foreground"> · {r.skipped}</span> : null}
                  {r.errors.length ? <span className="text-bad"> · {r.errors[0]}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4 className="text-xs font-semibold mb-1.5">Sources disagreeing (last 30 days: {conflicts?.total ?? "…"})</h4>
      {conflicts && conflicts.byField.length > 0 && (
        <p className="text-xs text-muted-foreground mb-2">
          {conflicts.byField.map((f) => `${FIELDS[f.field] ?? f.field}: ${f.count}`).join(" · ")}
        </p>
      )}
      {conflicts?.sample.length ? (
        <ul className="text-xs divide-y divide-border">
          {conflicts.sample.map((c) => (
            <li key={c._id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="font-medium">{FIELDS[c.field] ?? c.field}</span>{" "}
                <span className="text-muted-foreground">
                  {c.values.map((x) => `${x.source}: ${x.value}`).join(" vs ")} · {c.entity} {c.entityId.slice(-6)} · {c.day}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0"
                onClick={() => markReviewed({ id: c._id }).catch(() => toast.error("Couldn't save"))}
              >
                Reviewed
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing to review.</p>
      )}
    </div>
  );
}
