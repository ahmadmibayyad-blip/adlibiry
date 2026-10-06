import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useParams, Link } from "react-router-dom";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { motion } from "motion/react";
import {
  ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, TrendingUp,
  ShoppingCart, BarChart3, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";
import ProfitCalculator from "../_components/ProfitCalculator.tsx";
import AIProductScoreCard from "../_components/ai/AIProductScoreCard.tsx";
import AIAdAnglesCard from "../_components/ai/AIAdAnglesCard.tsx";
import AICompetitorFinderCard from "../_components/ai/AICompetitorFinderCard.tsx";
import CountrySaturationCard from "../_components/ai/CountrySaturationCard.tsx";
import ProductPerformance, { ProductHeadline } from "./_components/ProductPerformance.tsx";
import AddToShopify from "./_components/AddToShopify.tsx";
import ProductGallery from "./_components/ProductGallery.tsx";
import ScoreBreakdown from "./_components/ScoreBreakdown.tsx";
import { price } from "@/lib/money.ts";

const saturationColors: Record<string, string> = {
  Low: "text-good bg-good/10 border-good/20",
  Medium: "text-warn bg-warn/10 border-warn/20",
  High: "text-bad bg-bad/10 border-bad/20",
};
const trendColors: Record<string, string> = {
  Rising: "text-good bg-good/10 border-good/20",
  Stable: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  Declining: "text-bad bg-bad/10 border-bad/20",
  Unknown: "text-muted-foreground bg-muted border-border",
};


function SaveButtonDetail({ productId }: { productId: Id<"products"> }) {
  const isSaved = useQuery(api.products.isSaved, { productId });
  const toggleSave = useMutation(api.products.toggleSave);

  const handleSave = async () => {
    try {
      const result = await toggleSave({ productId });
      toast.success(result.saved ? "Product saved!" : "Removed from saved");
    } catch {
      toast.error("Please sign in to save products");
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleSave}
      className={cn(isSaved ? "border-primary/50 text-primary" : "")}
    >
      {isSaved ? (
        <><BookmarkCheck className="w-4 h-4 mr-2" />Saved</>
      ) : (
        <><Bookmark className="w-4 h-4 mr-2" />Save Product</>
      )}
    </Button>
  );
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const product = useQuery(
    api.products.getById,
    id ? { id: id as Id<"products"> } : "skip"
  );

  if (product === undefined) {
    return (
      <div className="p-5 lg:p-8 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-32 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="aspect-[4/3] rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-center">
        <h2 className="font-semibold text-lg mb-2">Product not found</h2>
        <Link to="/dashboard/products" className="text-primary hover:underline text-sm">
          ← Back to products
        </Link>
      </div>
    );
  }

  const hasPrice = product.price !== undefined;
  const hasCost = product.cost !== undefined;
  const margin =
    hasPrice && hasCost ? Math.round(((product.price! - product.cost!) / product.price!) * 100) : null;

  return (
    <div className="p-5 lg:p-8 max-w-6xl mx-auto">
      {/* Back */}
      <Link
        to="/dashboard/products"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to products
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: image + ad examples */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
        >
          <ProductGallery product={product} />
          {product.adExamples.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Ad examples</h3>
              <div className="space-y-2">
                {product.adExamples.map((ad, i) => (
                  <div key={i} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
                    <img
                      src={ad.imageUrl}
                      alt={`Ad ${i + 1}`}
                      className="w-12 h-12 rounded-md object-cover"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{ad.platform}</div>
                      <div className="text-xs text-muted-foreground">{ad.impressions} impressions</div>
                    </div>
                    <BarChart3 className="w-4 h-4 text-primary" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* Right: details */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-5"
        >
          {/* Title + badges */}
          <div>
            <div className="flex flex-wrap gap-2 mb-3">
              {product.saturation !== "Unknown" && (
                <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", saturationColors[product.saturation] ?? "text-muted-foreground bg-muted border-border")}>
                  {`${product.saturation} saturation`}
                </span>
              )}
              {product.trend !== "Unknown" && (
                <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", trendColors[product.trend])}>
                  <TrendingUp className="w-3 h-3 inline mr-1" />
                  {product.trend}
                </span>
              )}
              <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                {product.category}
              </span>
              {product.source === "adlibrary_api" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  Live ad spotted on AdLibrary.com
                </span>
              )}
              {product.source === "nexscope_api" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  Real Amazon listing via Nexscope.ai
                </span>
              )}
              {product.source === "tiktok_shop" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  TikTok Shop best-seller via Nexscope.ai
                </span>
              )}
              {product.source === "shopify" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  Shopify store running Facebook ads
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold leading-tight mb-2">{product.title}</h1>
            {product.aliases?.length ? (
              <p className="text-xs text-muted-foreground mb-2">Also listed as {product.aliases.slice(0, 3).join(", ")}</p>
            ) : null}
            <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
          </div>

          <ProductHeadline product={product} />

          {/* AI Score */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-foreground flex flex-col items-center justify-center shrink-0">
                <span className="font-display text-2xl font-bold leading-none text-background">{product.aiScore}</span>
                <span className="text-[10px] text-background/70 mt-0.5">of 100</span>
              </div>
              <div>
                <div className="text-sm font-semibold mb-0.5">AdSpy score</div>
                <p className="text-xs text-muted-foreground">
                  {product.scoreParts?.v2 !== undefined && product.scoreParts.v2 === product.aiScore
                    ? "Ad momentum, revenue, trend, competition and margin, ranked against every product we track."
                    : "Based on the data source's signals: how long the ads have run, their reach and engagement, and sales."}{" "}
                  Products scoring 65 or more, with real sales and several live ads, can make Winning Products.
                </p>
              </div>
            </div>
            <ScoreBreakdown product={product} />
          </div>

          {/* Pricing */}
          {hasPrice ? (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingCart className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Quick Numbers</h3>
              </div>
              {product.priceSource === "landing_page" && (
                <p className="text-xs text-muted-foreground mb-3">
                  Price read from the store's product page{product.originalPrice && !product.originalPrice.startsWith("USD") ? ` (${product.originalPrice}, converted to USD)` : ""}. Supplier cost isn't known — enter yours in the profit calculator.
                </p>
              )}
              {product.priceSource === "ad_data" && (
                <p className="text-xs text-muted-foreground mb-3">Price taken from the imported ad data.</p>
              )}
              {product.priceSource === "estimated_market" && (
                <p className="text-xs text-muted-foreground mb-3">
                  Estimated market price/cost for this category, benchmarked from Amazon listings — not this exact product's real price.
                </p>
              )}
              <div className={cn("grid gap-3", margin !== null ? "grid-cols-3" : hasCost ? "grid-cols-2" : "grid-cols-1", product.priceSource !== "estimated_market" && "mt-3")}>
                <div className="text-center p-2 bg-muted rounded-lg">
                  <div className="text-lg font-bold">{price(product.price!)}</div>
                  <div className="text-xs text-muted-foreground">Sell Price</div>
                </div>
                {hasCost && (
                  <div className="text-center p-2 bg-muted rounded-lg">
                    <div className="text-lg font-bold">{price(product.cost!)}</div>
                    <div className="text-xs text-muted-foreground">
                      {product.source === "nexscope_api" ? "Est. supplier cost" : "AliExpress"}
                    </div>
                  </div>
                )}
                {margin !== null && (
                  <div className="text-center p-2 bg-good/10 rounded-lg border border-good/20">
                    <div className="text-lg font-bold text-good">{margin}%</div>
                    <div className="text-xs text-muted-foreground">Margin</div>
                  </div>
                )}
              </div>
            </div>
          ) : product.originalPrice ? (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Pricing</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                The store sells it for {product.originalPrice} (we have no USD rate for that currency). Use the profit calculator
                with your own numbers.
              </p>
            </div>
          ) : null}

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {product.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="flex-1">
              <a href={product.supplierUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                {product.source === "adlibrary_api"
                  ? "View Live Store"
                  : product.source === "nexscope_api"
                    ? "View on Amazon"
                    : product.source === "tiktok_shop"
                      ? "View on TikTok Shop"
                      : product.source === "shopify"
                        ? "View store page"
                        : product.storeUrl
                      ? "Open landing page"
                      : "Find Supplier on AliExpress"}
              </a>
            </Button>
            {product.source !== "nexscope_api" && (
              <Button asChild variant="outline">
                <a
                  href={`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.title.slice(0, 80))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Find supplier
                </a>
              </Button>
            )}
            <AddToShopify product={product} />
            <Authenticated>
              <SaveButtonDetail productId={product._id} />
            </Authenticated>
          </div>

          {/* Profit calculator */}
          <ProfitCalculator basePrice={product.price ?? 0} baseCost={product.cost ?? 0} />

          {/* AI Intelligence tools */}
          <div className="space-y-4">
            <h3 className="font-display text-lg font-bold">AI tools</h3>
            <AIProductScoreCard
              title={product.title}
              description={product.description}
              price={product.price ?? 0}
              cost={product.cost ?? 0}
              category={product.category}
            />
            <AIAdAnglesCard
              title={product.title}
              description={product.description}
              category={product.category}
            />
            <AICompetitorFinderCard productTitle={product.title} category={product.category} />
            <CountrySaturationCard productTitle={product.title} niche={product.category} />
          </div>
        </motion.div>
      </div>

      <ProductPerformance product={product} />
    </div>
  );
}
