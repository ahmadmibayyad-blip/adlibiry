import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Filter, TrendingUp, X } from "lucide-react";
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
  { value: "curated", label: "Curated" },
];

export default function ProductsFeed() {
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
    },
    { initialNumItems: 12 }
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
  };

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
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
          Hand-picked by our research team. Sorted by publish date — freshest first.
        </p>
      </motion.div>

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
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button
                variant="outline"
                onClick={() => loadMore(12)}
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
