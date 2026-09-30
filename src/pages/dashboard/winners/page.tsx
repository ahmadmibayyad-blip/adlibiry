import { useState } from "react";
import { Link } from "react-router-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Check, Trophy } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/filters.tsx";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";

type Mode = "mixed" | "byNiche";

function RuleChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-card text-xs text-muted-foreground">
      <Check className="w-3.5 h-3.5 text-primary" />
      {children}
    </span>
  );
}

export default function WinnersPage() {
  const [mode, setMode] = useState<Mode>("mixed");
  const [niche, setNiche] = useState<string | undefined>(undefined);
  const summary = useQuery(api.winners.summary, {});
  const { results, status, loadMore } = usePaginatedQuery(api.winners.feed, { mode, niche }, { initialNumItems: 24 });

  const slots = summary?.slots ?? 50;
  const minScore = summary?.minScore ?? 65;

  // In "By niche" order, start a new heading whenever the niche changes.
  const sections: { niche: string | null; items: typeof results }[] = [];
  for (const r of results) {
    const key = mode === "byNiche" && !niche ? r.niche : null;
    const last = sections[sections.length - 1];
    if (last && last.niche === key) last.items.push(r);
    else sections.push({ niche: key, items: [r] });
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Trophy className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold">Winning Products</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              The best {slots} from every niche, shuffled together so you see variety. Updated every morning. Everything else is in{" "}
              <Link to="/dashboard/products" className="text-primary hover:underline">Products</Link>.
            </p>
          </div>
          <div className="flex items-center bg-card border border-border rounded-lg p-1" role="tablist" aria-label="Order">
            {([["mixed", "Mixed feed"], ["byNiche", "By niche"]] as const).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-3 h-8 rounded-md text-sm cursor-pointer",
                  mode === m ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <RuleChip>Top {slots} per niche only</RuleChip>
          <RuleChip>Score {minScore} or higher</RuleChip>
          <RuleChip>Niches take turns</RuleChip>
          <RuleChip>Big brands, print-on-demand & services removed</RuleChip>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-5">
          <Chip on={!niche} onClick={() => setNiche(undefined)}>
            All niches
            {summary && <span className="opacity-60 tabular-nums">{summary.total}</span>}
          </Chip>
          {summary?.perNiche.map((n) => (
            <Chip key={n.niche} on={niche === n.niche} onClick={() => setNiche(niche === n.niche ? undefined : n.niche)}>
              {n.niche}
              <span className="opacity-60 tabular-nums">{n.filled}</span>
            </Chip>
          ))}
        </div>

        {status === "LoadingFirstPage" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl px-6">
            <Trophy className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">Today's list isn't ready yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              It's rebuilt every morning from all products with a score of {minScore}+. Until then, browse everything in{" "}
              <Link to="/dashboard/products" className="text-primary hover:underline">Products</Link>.
            </p>
          </div>
        ) : (
          <>
            {sections.map((section, i) => (
              <section key={`${section.niche}-${i}`} className="mb-6">
                {section.niche && (
                  <h2 className="font-semibold mb-3">
                    {section.niche}
                    <span className="text-muted-foreground font-normal text-sm ml-2">
                      {summary?.perNiche.find((n) => n.niche === section.niche)?.filled ?? section.items.length}/{slots}
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                  {section.items.map((r) => (
                    <ProductCard key={r.product._id} product={r.product} isNewToday={r.isNewToday} />
                  ))}
                </div>
              </section>
            ))}
            {status === "CanLoadMore" && (
              <div className="flex justify-center mt-4">
                <Button variant="outline" onClick={() => loadMore(24)} className="px-8">Load 24 more</Button>
              </div>
            )}
            {status === "LoadingMore" && <p className="text-center mt-4 text-sm text-muted-foreground">Loading…</p>}
          </>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 self-start">
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold mb-1">Today's list</h2>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold tabular-nums">{summary?.total ?? "—"}</span>
            {summary && <span className="text-xs text-muted-foreground">{summary.newToday} new today</span>}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            A niche with fewer than {slots} products above score {minScore} shows fewer. It's never padded with weaker ones.
          </p>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Slots filled per niche</div>
          <div className="space-y-2.5">
            {summary?.perNiche.map((n) => (
              <button key={n.niche} className="block w-full text-left cursor-pointer group" onClick={() => setNiche(n.niche)}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="group-hover:text-primary">{n.niche}</span>
                  <span className="tabular-nums text-muted-foreground">{n.filled}/{slots}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (n.filled / slots) * 100)}%` }} />
                </div>
              </button>
            ))}
            {summary && summary.perNiche.length === 0 && <p className="text-xs text-muted-foreground">No niche has a qualifying product yet.</p>}
          </div>
          {summary?.updatedAt && (
            <p className="text-[11px] text-muted-foreground mt-4">Updated {new Date(summary.updatedAt).toLocaleString()}</p>
          )}
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">How a product gets in</div>
          <ol className="space-y-2 text-xs list-decimal list-inside marker:text-primary">
            <li>Every product is ranked inside its niche by score.</li>
            <li>The top {slots} with score {minScore}+ are kept.</li>
            <li>Niches take turns: the best from each niche, then the next best, and so on.</li>
            <li>Everything else stays in Products.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
