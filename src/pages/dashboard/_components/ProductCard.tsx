import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, TrendingUp } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";
import { revenueEstimate } from "@/lib/estimateFormat.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { price } from "@/lib/money.ts";

type Product = Doc<"products">;

const saturationColors: Record<string, string> = {
  Low: "text-good bg-good/10",
  Medium: "text-warn bg-warn/10",
  High: "text-bad bg-bad/10",
};

const trendColors: Record<string, string> = {
  Rising: "text-good",
  Stable: "text-chart-3",
  Declining: "text-bad",
  Unknown: "text-muted-foreground",
};

// Score badge: dark for strong products, quieter below the winner range.
function scoreTone(score: number) {
  if (score >= 85) return "bg-good text-white dark:text-background";
  if (score >= 65) return "bg-foreground text-background";
  return "bg-background/90 text-foreground border border-border";
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
  const revenue = revenueEstimate(product);

  return (
    <Link
      to={`/dashboard/products/${product._id}`}
      className="group flex flex-col h-full bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover:border-primary/40 hover:shadow-md transition-all"
    >
      {/* Image */}
      <div className="relative aspect-square sm:aspect-[4/3] overflow-hidden bg-muted">
        <ProductImage
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <div
            className={cn("flex items-baseline gap-1.5 rounded-lg px-2 py-1 shadow-sm", scoreTone(product.aiScore))}
            title="AdSpy score out of 100. The product page shows what it's based on."
          >
            <span className="text-[10px] font-medium opacity-80">Score</span>
            <span className="text-sm font-bold leading-none tabular-nums">{product.aiScore}</span>
          </div>
          {isNewToday && <div className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-brand text-[#15171c]">New</div>}
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
            {product.verifiedWinner && (
              <span
                className="text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-full bg-good/15 text-good"
                title="Verified winner: the ad registry, ad engagement and marketplace sales all point the same way, with a known margin and low competition."
              >
                ⭐ Verified
              </span>
            )}
            {product.winnerRank !== undefined && (
              <span
                className="text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                title={`Winning product: #${product.winnerRank} in ${product.category}`}
              >
                #{product.winnerRank} in {product.category}
              </span>
            )}
            {ads > 0 && (
              <span className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-brand/15 text-brand-ink">
                {ads} ad{ads === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {revenue && (
          <div className="text-[11px] text-muted-foreground" title="Estimated revenue per month (see the product page for how)">
            <span className="font-semibold text-foreground">{revenue.label}</span>/mo est. revenue
            {revenue.confidence && <span> · {revenue.confidence} confidence</span>}
          </div>
        )}
        <div className="mt-auto pt-1 flex items-end justify-between gap-2">
          {hasPrice ? (
            <div className="min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-base font-bold tabular-nums">{price(product.price!)}</span>
                {product.priceSource === "estimated_market" && (
                  <span className="text-[10px] text-muted-foreground">est.</span>
                )}
              </div>
              {product.priceSource === "landing_page" && product.originalPrice && !product.originalPrice.startsWith("USD") && (
                <div className="text-[10px] text-muted-foreground truncate">{product.originalPrice} in store</div>
              )}
            </div>
          ) : product.originalPrice ? (
            <span className="text-base font-bold truncate">{product.originalPrice}</span>
          ) : (
            <span />
          )}
          {margin !== null && (
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-good tabular-nums">{margin}%</div>
              <div className="text-[10px] text-muted-foreground">margin</div>
            </div>
          )}
          {margin === null && product.saturation !== "Unknown" && (
            <span className={cn("hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0", saturationColors[product.saturation] ?? "text-muted-foreground bg-muted")}>
              {product.saturation} saturation
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
