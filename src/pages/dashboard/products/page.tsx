import { usePaginatedQuery } from "convex/react";
import { Link } from "react-router-dom";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { compactNumber, domainOf } from "@/lib/adFormat.ts";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Filter, TrendingUp, X, Search, LayoutGrid, Table2, ExternalLink, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import { Button } from "@/components/ui/button.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import FilterNumberInput from "@/components/FilterNumberInput.tsx";
import FilterTogglePill from "@/components/FilterTogglePill.tsx";

const categories = [
  "All", "Electronics", "Health & Wellness", "Home & Living", "Fashion", "Beauty", "Pet Supplies", "Sports", "Toys", "Other",
];

const trendOptions = [
  { value: "none", label: "Any trend" },
  { value: "Rising", label: "Rising" },
  { value: "Stable", label: "Stable" },
  { value: "Declining", label: "Declining" },
  { value: "Unknown", label: "Unknown" },
];

const saturationOptions = [
  { value: "none", label: "Any saturation" },
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Unknown", label: "Unknown" },
];

const sourceOptions = [
  { value: "none", label: "Any source" },
  { value: "nexscope_api", label: "Real Amazon listing" },
  { value: "adlibrary_api", label: "Live ad spotted" },
  { value: "csv_import", label: "Imported (CSV)" },
  { value: "winninghunter", label: "WinningHunter" },
  { value: "curated", label: "Curated" },
];

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Winning score" },
  { value: "ads", label: "Most ads" },
  { value: "likes", label: "Most likes" },
  { value: "growth", label: "Fastest growth" },
  { value: "margin", label: "Best margin" },
  { value: "priceHigh", label: "Price: high → low" },
  { value: "priceLow", label: "Price: low → high" },
];

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
                    <span className="line-clamp-2 font-medium hover:text-primary max-w-[22rem]">{p.title}</span>
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
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [minAds, setMinAds] = useState("");
  const [view, setView] = useState<"table" | "grid">("table");
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [minAiScore, setMinAiScore] = useState("");
  const [trend, setTrend] = useState<string | undefined>(undefined);
  const [saturation, setSaturation] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [winnerOfDayOnly, setWinnerOfDayOnly] = useState(false);

  const parsedMinPrice = minPrice ? Number(minPrice) : undefined;
  const parsedMaxPrice = maxPrice ? Number(maxPrice) : undefined;
  const parsedMinMargin = minMargin ? Number(minMargin) : undefined;
  const parsedMinAiScore = minAiScore ? Number(minAiScore) : undefined;
  const activeFilterCount = [
    parsedMinPrice,
    parsedMaxPrice,
    parsedMinMargin,
    parsedMinAiScore,
    trend,
    saturation,
    source,
    winnerOfDayOnly ? true : undefined,
    minAds ? Number(minAds) : undefined,
  ].filter((v) => v !== undefined && !(typeof v === "number" && Number.isNaN(v))).length;

  const { results, status, loadMore } = usePaginatedQuery(
    api.products.list,
    {
      category: activeCategory,
      minPrice: parsedMinPrice,
      maxPrice: parsedMaxPrice,
      minMargin: parsedMinMargin,
      minAiScore: parsedMinAiScore,
      trend,
      saturation,
      source,
      winnerOfDayOnly: winnerOfDayOnly || undefined,
      search: debouncedSearch || undefined,
      sort,
      minAds: minAds ? Number(minAds) : undefined,
    },
    { initialNumItems: 30 }
  );

  const handleClearFilters = () => {
    setMinPrice("");
    setMaxPrice("");
    setMinMargin("");
    setMinAiScore("");
    setTrend(undefined);
    setSaturation(undefined);
    setSource(undefined);
    setWinnerOfDayOnly(false);
    setMinAds("");
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Winning Products</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Products with proven ads — sort by ads, likes, growth or score.
        </p>
      </motion.div>

      {/* Search + sort + view */}
      <div className="flex flex-col md:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full bg-card border border-border rounded-lg pl-9 pr-3 h-10 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect label="Sort" value={sort ?? "newest"} onChange={(v) => setSort(v === "newest" ? undefined : v)} options={sortOptions} active={!!sort} />
          <div className="flex items-center bg-card border border-border rounded-lg p-1">
            {([["table", Table2], ["grid", LayoutGrid]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={v === "table" ? "Table view" : "Grid view"}
                className={cn("p-1.5 rounded-md cursor-pointer", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category pills */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="flex items-center gap-2 mb-3 overflow-x-auto pb-2 scrollbar-hide"
      >
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        {categories.map((cat) => {
          const isActive = cat === "All" ? !activeCategory : activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat === "All" ? undefined : cat)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              )}
            >
              {cat}
            </button>
          );
        })}
      </motion.div>

      {/* Advanced filter bar — dense row of dropdowns/inputs, always visible */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border"
      >
        <FilterNumberInput label="Min price $" value={minPrice} onChange={setMinPrice} placeholder="0" />
        <FilterNumberInput label="Max price $" value={maxPrice} onChange={setMaxPrice} placeholder="Any" />
        <FilterNumberInput label="Min margin %" value={minMargin} onChange={setMinMargin} placeholder="0" />
        <FilterNumberInput label="Min AI score" value={minAiScore} onChange={setMinAiScore} placeholder="0" />
        <FilterNumberInput label="Min ads" value={minAds} onChange={setMinAds} placeholder="0" />
        <FilterSelect
          label="Trend"
          value={trend ?? "none"}
          onChange={(v) => setTrend(v === "none" ? undefined : v)}
          options={trendOptions}
          active={!!trend}
        />
        <FilterSelect
          label="Saturation"
          value={saturation ?? "none"}
          onChange={(v) => setSaturation(v === "none" ? undefined : v)}
          options={saturationOptions}
          active={!!saturation}
        />
        <FilterSelect
          label="Source"
          value={source ?? "none"}
          onChange={(v) => setSource(v === "none" ? undefined : v)}
          options={sourceOptions}
          active={!!source}
        />
        <FilterTogglePill
          label="Winner of day"
          active={winnerOfDayOnly}
          onToggle={() => setWinnerOfDayOnly((v) => !v)}
        />
        {activeFilterCount > 0 && (
          <button
            onClick={handleClearFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2"
          >
            <X className="w-3.5 h-3.5" />
            Clear ({activeFilterCount})
          </button>
        )}
      </motion.div>

      {/* Grid */}
      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <TrendingUp className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No products in this category</h3>
          <p className="text-sm text-muted-foreground">Try a different filter.</p>
        </div>
      ) : (
        <>
          {view === "table" ? <ProductTable products={results} /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((product, i) => (
              <motion.div
                key={product._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: (i % 8) * 0.04 }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </div>
          )}
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button
                variant="outline"
                onClick={() => loadMore(30)}
                className="px-8"
              >
                Load more products
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
