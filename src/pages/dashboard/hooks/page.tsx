import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Copy, Eye, Heart, Quote, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { compactNumber } from "@/lib/adFormat.ts";
import { parseCompact } from "@/convex/lib/productMatch.ts";
import { cn } from "@/lib/utils.ts";

// Hooks of the week (convex/hooks.ts, convex/hooksBuilder.ts): the best ad
// opening lines per niche, with type, why it works and a reusable template.

type Data = NonNullable<FunctionReturnType<typeof api.hooks.latest>>;
type Hook = Data["niches"][number]["hooks"][number];

const weekLabel = (week: string) => {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (w - 1) * 7 * 86_400_000);
  return `Week of ${monday.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}`;
};

function HookCard({ h, rank }: { h: Hook; rank: number }) {
  const views = h.ad ? (h.ad.impressions ?? parseCompact(h.ad.views) ?? 0) : 0;
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-2">
        <span className="text-xs font-bold text-muted-foreground tabular-nums mt-1">#{rank}</span>
        <p className="text-base font-semibold leading-snug flex-1">
          <Quote className="w-4 h-4 inline -mt-1 mr-1 text-primary" />
          {h.hook}
        </p>
      </div>
      {h.type && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{h.type}</span>
          {h.why && <span className="text-xs text-muted-foreground">{h.why}</span>}
        </div>
      )}
      {h.template && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border px-3 py-2">
          <p className="text-sm flex-1 min-w-0">{h.template}</p>
          <button
            type="button"
            title="Copy template"
            onClick={() => {
              void navigator.clipboard.writeText(h.template!);
              toast.success("Template copied");
            }}
            className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {h.ad && (
        <Link to={`/dashboard/ads/${h.ad._id}`} className="mt-auto flex items-center gap-3 rounded-lg p-2 -m-1 hover:bg-muted/60">
          {h.ad.creativeUrl ? (
            <img src={h.ad.creativeUrl} alt="" loading="lazy" className="w-10 h-12 rounded-md object-cover bg-muted shrink-0" />
          ) : (
            <div className="w-10 h-12 rounded-md bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate">{h.ad.advertiserName}</div>
            <div className="text-[11px] text-muted-foreground">{h.ad.platform}</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums shrink-0">
            {views > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" />
                {compactNumber(views)}
              </span>
            )}
            {h.ad.likes > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="w-3.5 h-3.5" />
                {compactNumber(h.ad.likes)}
              </span>
            )}
          </div>
        </Link>
      )}
    </div>
  );
}

function BuildNow() {
  const build = useAction(api.hooksBuilder.buildNow);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await build({});
          toast.success(`Built ${r.hooks} hooks in ${r.niches} niches${r.errors.length ? ` (${r.errors.length} AI errors)` : ""}`);
        } catch (e) {
          toast.error(e instanceof ConvexError ? (e.data as { message: string }).message : "Couldn't build the hooks");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
      {busy ? "Building… (about a minute)" : "Build now"}
    </Button>
  );
}

export default function HooksPage() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const data = useQuery(api.hooks.latest, week ? { week } : {});
  const me = useQuery(api.users.getCurrentUser, {});
  const isAdmin = me?.role === "admin";
  const [niche, setNiche] = useState<string>("All");

  const niches = data?.niches ?? [];
  const shown = niche === "All" ? niches : niches.filter((n) => n.niche === niche);

  return (
    <div className="p-5 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Hooks of the week</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            The opening lines of this week's most engaging ads, per niche. Each one has its hook type, why it works and a template you
            can reuse for your own product. New list every Monday.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.weeks.length > 1 && (
            <select
              value={data.week}
              onChange={(e) => setWeek(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              aria-label="Week"
            >
              {data.weeks.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
          )}
          {isAdmin && <BuildNow />}
        </div>
      </div>

      {data === undefined ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : data === null ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">The first list arrives on Monday</h3>
          <p className="text-sm text-muted-foreground">{isAdmin ? "Or click Build now to make it from this week's ads." : "Check back after Monday morning."}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {["All", ...niches.map((n) => n.niche)].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNiche(n)}
                className={cn(
                  "px-3 h-8 rounded-full text-xs border cursor-pointer transition-colors",
                  niche === n ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{weekLabel(data.week)}</p>
          {shown.map((n) => (
            <section key={n.niche} className="space-y-3">
              {niche === "All" && <h2 className="text-lg font-bold">{n.niche}</h2>}
              <div className="grid sm:grid-cols-2 gap-4">
                {(niche === "All" ? n.hooks.slice(0, 4) : n.hooks).map((h) => (
                  <HookCard key={h._id} h={h} rank={h.rank} />
                ))}
              </div>
              {niche === "All" && n.hooks.length > 4 && (
                <button type="button" onClick={() => setNiche(n.niche)} className="text-sm text-primary hover:underline cursor-pointer">
                  All {n.hooks.length} {n.niche} hooks →
                </button>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
