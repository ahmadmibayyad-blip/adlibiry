import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";

const LABELS: Record<string, string> = {
  adlibrary: "AdLibrary ads",
  nexscopePricing: "Nexscope pricing",
  nexscopeDiscovery: "Nexscope product discovery",
  nexscopeTikTok: "Nexscope TikTok ads",
  apify: "Apify Meta Ad Library (turned off)",
  metaAdLibrary: "Meta Ad Library API (official)",
  pipispy: "PiPiSpy",
  aliexpressCosts: "AliExpress supplier costs",
  winninghunter: "WinningHunter ads",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-good/10 text-good" },
  partial: { label: "Partly failed", cls: "bg-warn/10 text-warn" },
  failed: { label: "Failed", cls: "bg-bad/10 text-bad" },
  skipped: { label: "Not set up", cls: "bg-muted text-muted-foreground" },
};

// The last run of each daily import, so a failure (e.g. out of API credits)
// shows up here instead of only as data quietly not growing.
export default function ImportRunsCard() {
  const runs = useQuery(api.importRuns.latest, {});

  return (
    <section className="bg-card border border-border rounded-xl p-5 mb-5">
      <h2 className="font-semibold mb-1">Daily imports</h2>
      <p className="text-sm text-muted-foreground mb-4">The last run of each scheduled import, with any errors it reported.</p>
      {runs === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map(({ job, last, problemsLast7 }) => {
            const status = last ? STATUS[last.status] ?? STATUS.failed : null;
            return (
              <li key={job} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-sm">{LABELS[job] ?? job}</span>
                  {status ? (
                    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", status.cls)}>{status.label}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No runs recorded yet</span>
                  )}
                  {last && (
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(last.startedAt, { addSuffix: true })}, took {Math.max(1, Math.round((last.finishedAt - last.startedAt) / 1000))}s
                    </span>
                  )}
                  {problemsLast7 > 1 && <span className="text-xs text-bad">Problems in {problemsLast7} of the last 7 runs</span>}
                </div>
                {last && <p className="text-xs text-muted-foreground mt-1">{last.summary}</p>}
                {last && last.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-bad cursor-pointer">
                      {last.errors.length} error{last.errors.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {last.errors.map((e, i) => (
                        <li key={i} className="text-xs font-mono break-words text-muted-foreground">{e}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
