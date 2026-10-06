import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { LayoutGrid, Search, Table2, Trophy, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { Button } from "@/components/ui/button.tsx";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import ProductTable from "../_components/ProductTable.tsx";
import ImageSearchDialog from "../_components/ImageSearchDialog.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import FilterTogglePill from "@/components/FilterTogglePill.tsx";
import { Chip, SavedSearches } from "@/components/filters.tsx";
import { ANY, opt, range } from "@/lib/filterUtils.ts";
import TrialLimitNotice from "../_components/TrialLimitNotice.tsx";

type Mode = "mixed" | "byNiche";

// ── Filter model (same layout as Ad Spy and Products) ───────────────────────
type Filters = {
  niche?: string;
  source?: string;
  price?: string; // range, USD
  margin?: string; // min %
  ads?: string; // min
  likes?: string; // min
  score?: string; // min
  trend?: string;
  saturation?: string;
  newToday?: boolean;
  hasStore?: boolean;
  sort?: string;
};

// WinningHunter and CSV imports have no button of their own; they show under All.
const SOURCES = [
  ANY,
  opt("adlibrary_api", "Live ads"),
  opt("nexscope_api", "Amazon"),
  opt("tiktok_shop", "TikTok Shop"),
  opt("shopify", "Shopify"),
  opt("curated", "Curated"),
];
const PRICE = [ANY, opt("0-20", "Under $20"), opt("20-50", "$20–$50"), opt("50-100", "$50–$100"), opt("100-", "$100+")];
const MARGIN = [ANY, opt("30", "30%+"), opt("50", "50%+"), opt("70", "70%+")];
const ADS = [ANY, opt("1", "1+"), opt("10", "10+"), opt("50", "50+"), opt("200", "200+")];
const LIKES = [ANY, opt("100", "100+"), opt("1000", "1K+"), opt("10000", "10K+"), opt("100000", "100K+")];
// Every winner already scores 65+ (WINNER_MIN_SCORE).
const SCORE = [ANY, opt("70", "70+"), opt("80", "80+"), opt("90", "90+")];
const TREND = [ANY, opt("Rising", "Rising"), opt("Stable", "Stable"), opt("Declining", "Declining")];
const SATURATION = [ANY, opt("Low", "Low"), opt("Medium", "Medium"), opt("High", "High")];
const SORTS = [
  opt("rank", "Feed order"),
  opt("score", "Winning score"),
  opt("newest", "Newest"),
  opt("ads", "Ads running"),
  opt("likes", "Most likes"),
  opt("margin", "Margin"),
  opt("growth", "Fastest growth"),
  opt("revenue", "Est. revenue"),
  opt("priceHigh", "Price: high → low"),
  opt("priceLow", "Price: low → high"),
];
const SAVED_KEY = "winners.savedSearches";
const PAGE = 24;

const num = (v: string | undefined) => (v ? Number(v) : undefined);

function toQueryArgs(f: Filters, search: string, mode: Mode) {
  const price = range(f.price);
  return {
    mode,
    niche: f.niche,
    search: search || undefined,
    source: f.source,
    minPrice: price.min,
    maxPrice: price.max,
    minMargin: num(f.margin),
    minAds: num(f.ads),
    minLikes: num(f.likes),
    minAiScore: num(f.score),
    trend: f.trend,
    saturation: f.saturation,
    newToday: f.newToday || undefined,
    hasStoreLink: f.hasStore || undefined,
    sort: f.sort,
  };
}

export default function WinnersPage() {
  const [mode, setMode] = useState<Mode>("mixed");
  const [searchParams] = useSearchParams();
  // ?niche=… (e.g. from the dashboard's "Top niches") opens one niche.
  const [f, setF] = useState<Filters>(() => (searchParams.get("niche") ? { niche: searchParams.get("niche")! } : {}));
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setAny = (key: keyof Filters) => (v: string) => set(key, (v === "any" ? undefined : v) as never);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [view, setView] = useState<"grid" | "table">("grid");

  const summary = useQuery(api.winners.summary, {});
  const args = toQueryArgs(f, debouncedSearch, mode);
  const { results, status, loadMore } = usePaginatedQuery(api.winners.feed, args, { initialNumItems: PAGE });

  const slots = summary?.slots ?? 50;
  const minScore = summary?.minScore ?? 65;
  const activeCount = Object.entries(f).filter(([k, v]) => k !== "sort" && v !== undefined && v !== false).length;
  const clearAll = () => setF((prev) => ({ sort: prev.sort }));
  const sorted = !!f.sort && f.sort !== "rank";

  // "By niche" (feed order): start a new heading whenever the niche changes.
  const sections: { niche: string | null; items: typeof results }[] = [];
  for (const r of results) {
    const key = mode === "byNiche" && !f.niche && !sorted ? r.niche : null;
    const last = sections[sections.length - 1];
    if (last && last.niche === key) last.items.push(r);
    else sections.push({ niche: key, items: [r] });
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {/* Header + stats */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Trophy className="w-5 h-5 text-brand-ink" aria-hidden="true" />
              <h1 className="text-2xl font-bold">Winning Products</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              The best {slots} per niche with score {minScore}+, rebuilt every morning. Everything else is in{" "}
              <Link to="/dashboard/products" className="text-primary hover:underline">Products</Link>.
            </p>
          </div>
          {summary && (
            <div className="flex gap-2 text-xs">
              {[
                { label: "Winners", value: summary.total },
                { label: "New today", value: summary.newToday },
                { label: "Niches", value: summary.perNiche.length },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-lg px-3 py-1.5 text-center">
                  <div className="font-bold text-sm tabular-nums">{compactNumber(s.value)}</div>
                  <div className="text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <TrialLimitNotice />

        <div className="bg-card border border-border rounded-xl p-3 mb-5 space-y-2.5 shadow-sm">
          {/* Search + feed order */}
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search winning products…"
                className="w-full bg-background border border-border rounded-lg pl-9 pr-3 h-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center gap-2">
              <ImageSearchDialog trigger="icon" />
              <div className="flex items-center bg-background border border-border rounded-lg p-0.5 h-9" role="tablist" aria-label="Order">
                {([["mixed", "Mixed feed"], ["byNiche", "By niche"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "px-3 h-full rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors",
                      mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Niches, one tap each */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <Chip on={!f.niche} onClick={() => set("niche", undefined)}>
              All{summary ? ` (${summary.total})` : ""}
            </Chip>
            {(summary?.perNiche ?? []).map((n) => (
              <Chip key={n.niche} on={f.niche === n.niche} onClick={() => set("niche", f.niche === n.niche ? undefined : n.niche)}>
                {n.niche} <span className="opacity-60 tabular-nums">{n.filled}</span>
              </Chip>
            ))}
          </div>

          {/* Every filter as a dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Source" value={f.source ?? "any"} onChange={setAny("source")} options={SOURCES} active={!!f.source} />
            <FilterSelect label="Price" value={f.price ?? "any"} onChange={setAny("price")} options={PRICE} active={!!f.price} />
            <FilterSelect label="Margin" value={f.margin ?? "any"} onChange={setAny("margin")} options={MARGIN} active={!!f.margin} />
            <FilterSelect label="Ads running" value={f.ads ?? "any"} onChange={setAny("ads")} options={ADS} active={!!f.ads} />
            <FilterSelect label="Likes" value={f.likes ?? "any"} onChange={setAny("likes")} options={LIKES} active={!!f.likes} />
            <FilterSelect label="Score" value={f.score ?? "any"} onChange={setAny("score")} options={SCORE} active={!!f.score} />
            <FilterSelect label="Trend" value={f.trend ?? "any"} onChange={setAny("trend")} options={TREND} active={!!f.trend} />
            <FilterSelect label="Saturation" value={f.saturation ?? "any"} onChange={setAny("saturation")} options={SATURATION} active={!!f.saturation} />
          </div>

          {/* Toggles, sort, view, saved searches */}
          <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-border">
            <FilterTogglePill label="New today" active={!!f.newToday} onToggle={() => set("newToday", f.newToday ? undefined : true)} />
            <FilterTogglePill label="Has store link" active={!!f.hasStore} onToggle={() => set("hasStore", f.hasStore ? undefined : true)} />
            {activeCount > 0 && (
              <button onClick={clearAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2">
                <X className="w-3.5 h-3.5" />Clear ({activeCount})
              </button>
            )}
            <div className="flex-1" />
            <FilterSelect label="Sort by" value={f.sort ?? "rank"} onChange={(v) => set("sort", v === "rank" ? undefined : v)} options={SORTS} active={sorted} />
            <div className="flex items-center bg-background border border-border rounded-lg p-0.5">
              {([["grid", LayoutGrid], ["table", Table2]] as const).map(([v, Icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  title={v === "table" ? "Table view" : "Grid view"}
                  className={cn("p-1 rounded-md cursor-pointer", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
            <SavedSearches
              storageKey={SAVED_KEY}
              filters={f}
              search={search}
              onApply={(filters, q) => {
                setF(filters);
                setSearch(q);
              }}
            />
          </div>
        </div>

        {/* Results */}
        {status === "LoadingFirstPage" ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : results.length === 0 ? (
          activeCount > 0 || debouncedSearch ? (
            <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl px-6">
              <Trophy className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">No winning products match these filters</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Try removing a filter, or search all products in <Link to="/dashboard/products" className="text-primary hover:underline">Products</Link>.
              </p>
              {activeCount > 0 && <Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button>}
            </div>
          ) : (
            <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl px-6">
              <Trophy className="w-10 h-10 text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">Today's list isn't ready yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                It's rebuilt every morning from all products with a score of {minScore}+. Until then, browse everything in{" "}
                <Link to="/dashboard/products" className="text-primary hover:underline">Products</Link>.
              </p>
            </div>
          )
        ) : (
          <>
            {view === "table" ? (
              <ProductTable products={results.map((r) => r.product)} />
            ) : (
              sections.map((section, i) => (
                <section key={`${section.niche}-${i}`} className="mb-6">
                  {section.niche && (
                    <h2 className="font-semibold mb-3">
                      {section.niche}
                      <span className="text-muted-foreground font-normal text-sm ml-2">
                        {summary?.perNiche.find((n) => n.niche === section.niche)?.filled ?? section.items.length}/{slots}
                      </span>
                    </h2>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-5">
                    {section.items.map((r) => (
                      <ProductCard key={r.product._id} product={r.product} isNewToday={r.isNewToday} />
                    ))}
                  </div>
                </section>
              ))
            )}
            {status === "CanLoadMore" ? (
              <div className="flex justify-center mt-6">
                <Button variant="outline" onClick={() => loadMore(PAGE)} className="px-8">Load {PAGE} more</Button>
              </div>
            ) : status === "LoadingMore" ? (
              <p className="text-center mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <p className="text-center mt-6 text-xs text-muted-foreground">
                Showing all {results.length} matching winner{results.length === 1 ? "" : "s"}.
              </p>
            )}
          </>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 self-start">
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-display text-lg font-bold mb-1">Today's list</h2>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-display text-4xl font-bold tabular-nums">{summary?.total ?? "—"}</span>
            {summary && <span className="text-xs text-muted-foreground">{summary.newToday} new today</span>}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            A niche with fewer than {slots} products above score {minScore} shows fewer. It's never padded with weaker ones.
            Big brands, print-on-demand and services are left out.
          </p>
          <h3 className="text-sm font-semibold mb-2">Slots filled per niche</h3>
          <div className="space-y-2.5">
            {summary?.perNiche.map((n) => (
              <button key={n.niche} className="block w-full text-left cursor-pointer group" onClick={() => set("niche", n.niche)}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={cn("group-hover:text-primary", f.niche === n.niche && "text-primary font-medium")}>{n.niche}</span>
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
          <h3 className="text-sm font-semibold mb-2">How a product gets in</h3>
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
