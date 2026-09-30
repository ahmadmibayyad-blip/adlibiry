import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, TrendingUp, Zap } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";

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
        "p-2 rounded-lg border border-border transition-all cursor-pointer",
        isSaved
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-background/80 text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
      title={isSaved ? "Remove from saved" : "Save product"}
    >
      {isSaved ? (
        <BookmarkCheck className="w-4 h-4" />
      ) : (
        <Bookmark className="w-4 h-4" />
      )}
    </button>
  );
}

export default function ProductCard({ product, isNewToday }: { product: Product; isNewToday?: boolean }) {
  const hasPrice = product.price !== undefined;
  const hasCost = product.cost !== undefined;
  const margin =
    hasPrice && hasCost ? Math.round(((product.price! - product.cost!) / product.price!) * 100) : null;

  return (
    <Link
      to={`/dashboard/products/${product._id}`}
      className="group block bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {/* AI Score badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-lg px-2 py-1 border border-border">
          <Zap className="w-3 h-3 text-primary" />
          <span className={cn("text-xs font-bold", scoreColor(product.aiScore))}>
            {product.aiScore}
          </span>
        </div>
        {isNewToday && (
          <div className="absolute top-11 left-2 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-orange-500 text-white">New today</div>
        )}
        {/* Save button */}
        <div className="absolute top-2 right-2">
          <Authenticated>
            <SaveButton productId={product._id} />
          </Authenticated>
        </div>
        {/* Trend badge */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-md px-2 py-0.5 border border-border">
          <TrendingUp className={cn("w-3 h-3", trendColors[product.trend])} />
          <span className={cn("text-[11px] font-medium", trendColors[product.trend])}>
            {product.trend}
          </span>
        </div>
        {/* Live ad badge for auto-synced products */}
        {product.source === "adlibrary_api" && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-md px-2 py-0.5 border border-border">
            <span className="text-[11px] font-medium text-primary">Live ad spotted</span>
          </div>
        )}
        {product.source === "nexscope_api" && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-md px-2 py-0.5 border border-border">
            <span className="text-[11px] font-medium text-primary">Real Amazon listing</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {product.title}
          </h3>
        </div>

        <div className="text-xs text-muted-foreground mb-2">{product.category}</div>

        {(product.winnerRank !== undefined || (product.linkedAds ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {product.winnerRank !== undefined && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                Winner · #{product.winnerRank} in {product.category}
              </span>
            )}
            {(product.linkedAds ?? 0) > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
                From {product.linkedAds} ad{product.linkedAds === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {hasPrice ? (
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-1">
                <div className="text-base font-bold">${product.price}</div>
                {product.priceSource === "estimated_market" && (
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">est.</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {hasCost ? `Cost: $${product.cost}` : "Cost unknown"}
              </div>
            </div>
            {margin !== null ? (
              <div className="text-right">
                <div className="text-sm font-bold text-green-400">{margin}%</div>
                <div className="text-xs text-muted-foreground">Margin</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mb-3 text-xs text-muted-foreground">
            Price varies by supplier — see landing page
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", saturationColors[product.saturation] ?? "text-muted-foreground bg-muted")}>
            {product.saturation === "Unknown" ? "Saturation unknown" : `${product.saturation} sat.`}
          </span>
          {product.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-muted" />
      <div className="p-4 space-y-3">
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
