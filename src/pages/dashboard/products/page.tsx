import { useEffect, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import ImageSearchDialog from "../_components/ImageSearchDialog.tsx";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { compactNumber, domainOf } from "@/lib/adFormat.ts";
import { api } from "@/convex/_generated/api.js";
import { TrendingUp, X, Search, LayoutGrid, Table2, ExternalLink, ArrowUpRight, ArrowDownRight, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.tsx";
import { cn } from "@/lib/utils.ts";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import { Button } from "@/components/ui/button.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { Chip, Check, SavedSearches } from "@/components/filters.tsx";
import { ANY, opt, range } from "@/lib/filterUtils.ts";

// ── Filter model (same layout as Ad Spy) ────────────────────────────────────
type Filters = {
  source?: string;
  origin?: "db" | "ads";
  categories?: string[];
  /** Old saved searches stored a single niche. */
  category?: string;
  hideBrands?: boolean;
  hidePersonalised?: boolean;
  hideServices?: boolean;
  added?: string; // days
  price?: string; // range, USD
  margin?: string; // min %
  ads?: string; // range
  likes?: string; // range
  growth?: string; // range, %
  score?: string; // range
  trend?: string;
  saturation?: string;
  winner?: boolean;
  hasPrice?: boolean;
  hasStore?: boolean;
  sort?: string;
};

const ORIGINS = [
  { value: undefined, label: "All" },
  { value: "db" as const, label: "Product DB" },
  { value: "ads" as const, label: "From ads" },
];

// WinningHunter and CSV imports run in the background: their products show
// under All, but they get no filter button of their own.
const SOURCES = [
  { value: undefined, label: "All" },
  { value: "adlibrary_api", label: "Live ads" },
  { value: "nexscope_api", label: "Amazon" },
  { value: "tiktok_shop", label: "TikTok Shop" },
  { value: "shopify", label: "Shopify" },
  { value: "curated", label: "Curated" },
];

const ADDED = [
  { value: undefined, label: "All" },
  { value: "1", label: "Last 24h" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last year" },
];

const PRICE = [ANY, opt("0-20", "Under $20"), opt("20-50", "$20–$50"), opt("50-100", "$50–$100"), opt("100-", "$100+")];
const MARGIN = [ANY, opt("30", "30%+"), opt("50", "50%+"), opt("70", "70%+")];
const ADS = [ANY, opt("1-9", "1–9"), opt("10-49", "10–49"), opt("50-199", "50–199"), opt("200-", "200+")];
const LIKES = [ANY, opt("100-", "100+"), opt("1000-", "1K+"), opt("10000-", "10K+"), opt("100000-", "100K+")];
const GROWTH = [ANY, opt("10-", "Growing 10%+"), opt("50-", "Growing 50%+"), opt("100-", "Growing 100%+"), opt("-1000-0", "Declining")];
const SCORE = [ANY, opt("40-", "40+"), opt("60-", "60+"), opt("80-", "80+")];
const TREND = [ANY, opt("Rising", "Rising"), opt("Stable", "Stable"), opt("Declining", "Declining"), opt("Unknown", "Unknown")];
const SATURATION = [ANY, opt("Low", "Low"), opt("Medium", "Medium"), opt("High", "High"), opt("Unknown", "Unknown")];
const SORTS = [
  opt("newest", "Newest"),
  opt("score", "Winning score"),
  opt("ads", "Ads running"),
  opt("margin", "Margin"),
  opt("likes", "Most likes"),
  opt("growth", "Fastest growth"),
  opt("priceHigh", "Price: high → low"),
  opt("priceLow", "Price: low → high"),
];
const SAVED_KEY = "products.savedSearches";

// "-1000-0" (declining) splits as ["", "1000", "0"]; handle negative mins.
function growthRange(v: string | undefined) {
  if (v === "-1000-0") return { min: undefined, max: 0 };
  return range(v);
}

function toQueryArgs(f: Filters, search: string) {
  const price = range(f.price);
  const ads = range(f.ads);
  const likes = range(f.likes);
  const growth = growthRange(f.growth);
  return {
    source: f.source,
    origin: f.origin,
    categories: f.categories?.length ? f.categories : f.category ? [f.category] : undefined,
    hideBigBrands: f.hideBrands || undefined,
    hidePersonalised: f.hidePersonalised || undefined,
    hideServices: f.hideServices || undefined,
    publishedWithinDays: f.added ? Number(f.added) : undefined,
    minPrice: price.min,
    maxPrice: price.max,
    minMargin: f.margin ? Number(f.margin) : undefined,
    minAds: ads.min,
    maxAds: ads.max,
    minLikes: likes.min,
    maxLikes: likes.max,
    minGrowth: growth.min,
    maxGrowth: growth.max,
    minAiScore: range(f.score).min,
    trend: f.trend,
    saturation: f.saturation,
    winnerOfDayOnly: f.winner || undefined,
    hasPrice: f.hasPrice || undefined,
    hasStoreLink: f.hasStore || undefined,
    search: search || undefined,
    sort: f.sort,
  };
}

type Product = Doc<"products">;

function ProductTable({ products }: { products: Product[] }) {
  return (
    <div className="border border-border rounded-xl overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="text-xs text-muted-foreground border-b border-border bg-muted/40">
          <tr>
            <th className="text-left font-medium px-3 py-2.5">Product</th>
            <th className="text-right font-medium px-3 py-2.5">Price</th>
            <th className="text-right font-medium px-3 py-2.5">Ads</th>
            <th className="text-right font-medium px-3 py-2.5">Likes</th>
            <th className="text-right font-medium px-3 py-2.5">Growth</th>
            <th className="text-right font-medium px-3 py-2.5">Score</th>
            <th className="text-left font-medium px-3 py-2.5">Category</th>
            <th className="text-left font-medium px-3 py-2.5">Store</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const store = domainOf(p.storeUrl ?? p.supplierUrl);
            const g = p.growthPercent;
            return (
              <tr key={p._id} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link to={`/dashboard/products/${p._id}`} className="flex items-center gap-3 min-w-0">
                    <img src={p.imageUrl} alt="" loading="lazy" className="w-12 h-12 rounded-md object-cover bg-muted shrink-0" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-medium hover:text-primary max-w-[22rem]">{p.title}</span>
                      {(p.winnerRank !== undefined || (p.linkedAds ?? 0) > 0) && (
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          {p.winnerRank !== undefined && (
                            <span className="text-[10px] font-semibold px-1.5 rounded bg-primary/15 text-primary">Winner #{p.winnerRank}</span>
                          )}
                          {(p.linkedAds ?? 0) > 0 && (
                            <span className="text-[10px] font-medium px-1.5 rounded bg-orange-500/15 text-orange-400">From {p.linkedAds} ad{p.linkedAds === 1 ? "" : "s"}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {p.price !== undefined ? `$${p.price.toFixed(2)}` : p.originalPrice ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{compactNumber(p.adsCount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{compactNumber(p.likes)}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {g === undefined ? "—" : (
                    <span className={cn("inline-flex items-center gap-0.5", g >= 0 ? "text-green-400" : "text-red-400")}>
                      {g >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(g).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">{p.aiScore}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{p.category}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[10rem] truncate">{store || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    {(p.storeUrl || p.supplierUrl) && (
                      <a href={p.storeUrl || p.supplierUrl} target="_blank" rel="noopener noreferrer" title="Open store" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {p.researchUrl && (
                      <a href={p.researchUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded border border-border hover:border-primary hover:text-primary whitespace-nowrap">
                        Ads
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductsFeed() {
  const [f, setF] = useState<Filters>({});
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setAny = (key: keyof Filters) => (v: string) => set(key, (v === "any" ? undefined : v) as never);
  const [params] = useSearchParams();
  // ?search=… (e.g. from image search) presets the search box.
  const [search, setSearch] = useState(() => params.get("search") ?? "");
  const [debouncedSearch] = useDebounce(search, 300);
  const [view, setView] = useState<"table" | "grid">("table");

  const stats = useQuery(api.stats.get, {});
  const categories = stats?.products.categories ?? [];
  const sourceCounts = Object.fromEntries((stats?.products.sources ?? []).map((c) => [c.value, c.n]));

  const args = toQueryArgs(f, debouncedSearch);
  const { results, status, loadMore } = usePaginatedQuery(api.products.list, args, { initialNumItems: 30 });

  // Margin is matched after a page is read, so a page can come back short:
  // keep reading until the list has as many products as asked for.
  const PAGE = 30;
  const filterKey = JSON.stringify(args);
  const [wanted, setWanted] = useState({ key: filterKey, n: PAGE });
  const target = wanted.key === filterKey ? wanted.n : PAGE;
  const topUps = useRef({ key: "", target: 0, n: 0 });
  useEffect(() => {
    if (topUps.current.key !== filterKey || topUps.current.target !== target) topUps.current = { key: filterKey, target, n: 0 };
    if (status === "CanLoadMore" && results.length < target && topUps.current.n < 15) {
      topUps.current.n++;
      loadMore(60);
    }
  }, [status, results.length, filterKey, target, loadMore]);
  const showMore = () => setWanted({ key: filterKey, n: Math.max(target, results.length) + PAGE });

  const selectedNiches = f.categories ?? (f.category ? [f.category] : []);
  const toggleNiche = (n: string) =>
    setF((prev) => {
      const current = prev.categories ?? (prev.category ? [prev.category] : []);
      const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n];
      return { ...prev, category: undefined, categories: next.length ? next : undefined };
    });

  const activeCount = Object.entries(f).filter(([k, v]) => k !== "sort" && v !== undefined && v !== false).length;
  const clearAll = () => setF((prev) => ({ sort: prev.sort }));

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header + stats */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Products</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Everything we track, including products found inside running ads. Only the best reach{" "}
            <Link to="/dashboard/winners" className="text-primary hover:underline">Winning Products</Link>.
          </p>
        </div>
        {stats && (
          <div className="flex gap-2 text-xs">
            {[
              { label: "Products", value: stats.products.total },
              { label: "Niches", value: categories.length },
              { label: "Sources", value: (stats.products.sources ?? []).length },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-lg px-3 py-1.5 text-center">
                <div className="font-bold text-sm tabular-nums">{compactNumber(s.value)}</div>
                <div className="text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-3 mb-5 space-y-3">
        {/* Where the product comes from */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1 shrink-0">Show</span>
          {ORIGINS.map((o) => (
            <Chip key={o.label} on={f.origin === o.value} onClick={() => set("origin", o.value)}>{o.label}</Chip>
          ))}
          <span className="text-[11px] text-muted-foreground ml-1">"From ads" = products we found inside running ads; several ads for one product are merged.</span>
        </div>

        {/* Source + search */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {SOURCES.map((s) => (
              <Chip key={s.label} on={f.source === s.value} onClick={() => set("source", s.value)}>
                {s.label}
                {s.value && sourceCounts[s.value] !== undefined && <span className="opacity-60 tabular-nums">{compactNumber(sourceCounts[s.value])}</span>}
              </Chip>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product names…"
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 h-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <ImageSearchDialog trigger="icon" />
        </div>

        {/* Niche (pick several) and date added */}
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "h-8 text-xs rounded-full px-3 inline-flex items-center gap-1 border bg-card border-border cursor-pointer",
                  selectedNiches.length > 0 && "border-primary text-primary bg-primary/10",
                )}
              >
                <span className="text-muted-foreground font-normal mr-0.5">Niche:</span>
                {selectedNiches.length === 0 ? "All" : selectedNiches.length === 1 ? selectedNiches[0] : `${selectedNiches.length} niches`}
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              <DropdownMenuCheckboxItem
                checked={selectedNiches.length === 0}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => setF((prev) => ({ ...prev, categories: undefined, category: undefined }))}
              >
                All niches
              </DropdownMenuCheckboxItem>
              {categories.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.value}
                  checked={selectedNiches.includes(c.value)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleNiche(c.value)}
                >
                  <span className="flex-1">{c.value}</span>
                  <span className="text-muted-foreground tabular-nums ml-3">{compactNumber(c.n)}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <FilterSelect
            label="Added"
            value={f.added ?? "all"}
            onChange={(v) => set("added", v === "all" ? undefined : v)}
            active={f.added !== undefined}
            options={ADDED.map((o) => ({ value: o.value ?? "all", label: o.label }))}
          />
        </div>

        {/* Metrics */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Price" value={f.price ?? "any"} onChange={setAny("price")} options={PRICE} active={!!f.price} />
          <FilterSelect label="Margin" value={f.margin ?? "any"} onChange={setAny("margin")} options={MARGIN} active={!!f.margin} />
          <FilterSelect label="Ads running" value={f.ads ?? "any"} onChange={setAny("ads")} options={ADS} active={!!f.ads} />
          <FilterSelect label="Likes" value={f.likes ?? "any"} onChange={setAny("likes")} options={LIKES} active={!!f.likes} />
          <FilterSelect label="Growth" value={f.growth ?? "any"} onChange={setAny("growth")} options={GROWTH} active={!!f.growth} />
          <FilterSelect label="Winning score" value={f.score ?? "any"} onChange={setAny("score")} options={SCORE} active={!!f.score} />
          <FilterSelect label="Trend" value={f.trend ?? "any"} onChange={setAny("trend")} options={TREND} active={!!f.trend} />
          <FilterSelect label="Saturation" value={f.saturation ?? "any"} onChange={setAny("saturation")} options={SATURATION} active={!!f.saturation} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Check label="Winner of the day" checked={!!f.winner} onChange={(v) => set("winner", v || undefined)} />
          <Check label="Has price" checked={!!f.hasPrice} onChange={(v) => set("hasPrice", v || undefined)} />
          <Check label="Has store link" checked={!!f.hasStore} onChange={(v) => set("hasStore", v || undefined)} />
          <span className="text-xs text-muted-foreground ml-2">Hide</span>
          <Check label="Big brands (Apple, Bissell…)" checked={!!f.hideBrands} onChange={(v) => set("hideBrands", v || undefined)} />
          <Check label="Personalised / print-on-demand" checked={!!f.hidePersonalised} onChange={(v) => set("hidePersonalised", v || undefined)} />
          <Check label="Services & gift cards" checked={!!f.hideServices} onChange={(v) => set("hideServices", v || undefined)} />
        </div>

        {/* Sort, view, saved searches */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
          <FilterSelect label="Sort by" value={f.sort ?? "newest"} onChange={(v) => set("sort", v === "newest" ? undefined : v)} options={SORTS} active={!!f.sort} />
          {activeCount > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2">
              <X className="w-3.5 h-3.5" />Clear filters ({activeCount})
            </button>
          )}
          <div className="flex-1" />
          <div className="flex items-center bg-background border border-border rounded-lg p-1">
            {([["table", Table2], ["grid", LayoutGrid]] as const).map(([v, Icon]) => (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : results.length === 0 && status !== "LoadingMore" ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <TrendingUp className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No products match these filters</h3>
          <p className="text-sm text-muted-foreground mb-3">Try removing a filter.</p>
          {activeCount > 0 && <Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button>}
        </div>
      ) : (
        <>
          {view === "table" ? (
            <ProductTable products={results} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {results.map((product) => <ProductCard key={product._id} product={product} />)}
            </div>
          )}
          {status === "LoadingMore" ? (
            <div className="flex justify-center mt-8 text-sm text-muted-foreground">Loading…</div>
          ) : status === "CanLoadMore" ? (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={showMore} className="px-8">Load more products</Button>
            </div>
          ) : (
            <p className="text-center mt-8 text-xs text-muted-foreground">
              Showing all {results.length} matching product{results.length === 1 ? "" : "s"}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
