import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, TrendingUp, Zap } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";
import { rangeLabel } from "@/lib/estimateFormat.ts";

type Product = Doc<"products">;

const saturationColors: Record<string, string> = {
  Low: "text-green-400 bg-green-400/10",
  Medium: "text-yellow-400 bg-yellow-400/10",
  High: "text-red-400 bg-red-400/10",
};

const trendColors: Record<string, string> = {
  Rising: "text-green-400",
  Stable: "text-blue-400",
  Declining: "text-red-400",
  Unknown: "text-muted-foreground",
};

function scoreColor(score: number) {
  if (score >= 85) return "text-green-400";
  if (score >= 70) return "text-yellow-400";
  return "text-red-400";
}

function SaveButton({ productId }: { productId: Id<"products"> }) {
  const isSaved = useQuery(api.products.isSaved, { productId });
  const toggleSave = useMutation(api.products.toggleSave);

  const handleSave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await toggleSave({ productId });
      toast.success(result.saved ? "Product saved!" : "Removed from saved");
    } catch {
      toast.error("Please sign in to save products");
    }
  };

  return (
    <button
      onClick={handleSave}
      className={cn(
        "p-1.5 rounded-full border border-border shadow-sm transition-all cursor-pointer",
        isSaved
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-background/90 text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
      title={isSaved ? "Remove from saved" : "Save product"}
    >
      {isSaved ? (
        <BookmarkCheck className="w-3.5 h-3.5" />
      ) : (
        <Bookmark className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

export default function ProductCard({ product, isNewToday }: { product: Product; isNewToday?: boolean }) {
  const hasPrice = product.price !== undefined;
  const hasCost = product.cost !== undefined;
  const margin =
    hasPrice && hasCost ? Math.round(((product.price! - product.cost!) / product.price!) * 100) : null;
  const ads = product.linkedAds ?? 0;

  return (
    <Link
      to={`/dashboard/products/${product._id}`}
      className="group flex flex-col h-full bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover:border-primary/40 hover:shadow-md transition-all"
    >
      {/* Image */}
      <div className="relative aspect-square sm:aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={product.imageUrl}
          alt={product.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <div className="flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-full px-2 py-0.5 shadow-sm" title="AI score">
            <Zap className="w-3 h-3 text-primary" />
            <span className={cn("text-xs font-bold tabular-nums", scoreColor(product.aiScore))}>{product.aiScore}</span>
          </div>
          {isNewToday && <div className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-500 text-white">New today</div>}
        </div>
        <div className="absolute top-2 right-2">
          <Authenticated>
            <SaveButton productId={product._id} />
          </Authenticated>
        </div>
        {product.trend !== "Unknown" && (
          <div className="absolute bottom-2 left-2 hidden sm:flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-full px-2 py-0.5">
            <TrendingUp className={cn("w-3 h-3", trendColors[product.trend])} />
            <span className={cn("text-[11px] font-medium", trendColors[product.trend])}>{product.trend}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-3 sm:p-4 gap-2">
        <div>
          <h3 className="font-semibold text-[13px] sm:text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {product.title}
          </h3>
          <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">{product.category}</div>
        </div>

        {(product.winnerRank !== undefined || ads > 0) && (
          <div className="flex flex-wrap gap-1">
            {product.winnerRank !== undefined && (
              <span
                className="text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                title={`#${product.winnerRank} in ${product.category}`}
              >
                Winner #{product.winnerRank}
              </span>
            )}
            {ads > 0 && (
              <span className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400">
                {ads} ad{ads === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {rangeLabel(product.estRevenue, true) && (
          <div className="text-[11px] text-muted-foreground" title="Estimated revenue per month (see the product page for how)">
            <span className="font-semibold text-foreground">{rangeLabel(product.estRevenue, true)}</span>/mo est. revenue
          </div>
        )}
        <div className="mt-auto pt-1 flex items-end justify-between gap-2">
          {hasPrice ? (
            <div className="min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-base font-bold tabular-nums">${product.price}</span>
                {product.priceSource === "estimated_market" && (
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">est.</span>
                )}
              </div>
              {product.priceSource === "landing_page" && product.originalPrice && !product.originalPrice.startsWith("USD") && (
                <div className="text-[10px] text-muted-foreground truncate">{product.originalPrice} in store</div>
              )}
            </div>
          ) : product.originalPrice ? (
            <span className="text-base font-bold truncate">{product.originalPrice}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Price not found yet</span>
          )}
          {margin !== null && (
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-primary tabular-nums">{margin}%</div>
              <div className="text-[10px] text-muted-foreground">margin</div>
            </div>
          )}
          {margin === null && product.saturation !== "Unknown" && (
            <span className={cn("hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0", saturationColors[product.saturation] ?? "text-muted-foreground bg-muted")}>
              {product.saturation} sat.
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-square sm:aspect-[4/3] bg-muted" />
      <div className="p-3 sm:p-4 space-y-3">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/3" />
        <div className="flex justify-between">
          <div className="h-5 bg-muted rounded w-16" />
          <div className="h-5 bg-muted rounded w-12" />
        </div>
        <div className="flex gap-2">
          <div className="h-5 bg-muted rounded-full w-20" />
          <div className="h-5 bg-muted rounded-full w-16" />
        </div>
      </div>
    </div>
  );
}
