import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import AddToCollection from "@/components/AddToCollection.tsx";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { motion, MotionConfig } from "motion/react";
import {
  ArrowLeft, Bookmark, BookmarkCheck, ExternalLink, TrendingUp,
  ShoppingCart, BarChart3, Tag, MoreHorizontal, ShoppingBag, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";
import ProfitCalculator from "../_components/ProfitCalculator.tsx";
import { AIToolsGrid } from "../_components/ProductTools.tsx";
import ProductPerformance, { ProductHeadline } from "./_components/ProductPerformance.tsx";
import AddToShopify from "./_components/AddToShopify.tsx";
import LaunchDialog from "./_components/LaunchDialog.tsx";
import ProductGallery from "./_components/ProductGallery.tsx";
import ScoreBreakdown from "./_components/ScoreBreakdown.tsx";
import { price } from "@/lib/money.ts";
import { compactNumber, flag } from "@/lib/adFormat.ts";
import FollowProduct, { FollowMenuItem } from "./_components/FollowProduct.tsx";
import VerdictPanel from "./_components/VerdictPanel.tsx";
import SourceAgreement from "./_components/SourceAgreement.tsx";
import SuppliersSection from "./_components/SuppliersSection.tsx";
import MarketsSection from "./_components/MarketsSection.tsx";
import YoutubeSection from "./_components/YoutubeSection.tsx";

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


function SaveButtonDetail({ productId, iconOnly }: { productId: Id<"products">; iconOnly?: boolean }) {
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

  if (iconOnly) {
    return (
      <Button
        variant="outline"
        size="icon"
        onClick={handleSave}
        aria-label={isSaved ? "Remove from saved" : "Save product"}
        aria-pressed={!!isSaved}
        className={cn("h-10 w-10 shrink-0", isSaved && "border-primary/50 text-primary")}
      >
        {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
      </Button>
    );
  }

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
  // North-star funnel: product opened (convex/events.ts).
  const track = useMutation(api.events.track);
  useEffect(() => {
    if (id) track({ type: "product_open", productId: id as Id<"products"> }).catch(() => {});
  }, [id, track]);
  // Back to wherever the user came from (Winners, Saved, an ad…); a direct visit has no in-app history.
  const navigate = useNavigate();
  const hasHistory = useLocation().key !== "default";
  // Quick add opened from the phone action bar's More menu.
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
          ← Back to all products
        </Link>
      </div>
    );
  }

  const hasPrice = product.price !== undefined;
  const hasCost = product.cost !== undefined;
  const margin =
    hasPrice && hasCost ? Math.round(((product.price! - product.cost!) / product.price!) * 100) : null;
  // Without a store or listing to open, the main button already searches AliExpress.
  const mainIsSupplierSearch =
    !["adlibrary_api", "nexscope_api", "tiktok_shop", "shopify"].includes(product.source ?? "") && !product.storeUrl;
  const viewLabel =
    product.source === "adlibrary_api"
      ? "View Live Store"
      : product.source === "nexscope_api"
        ? "View on Amazon"
        : product.source === "tiktok_shop"
          ? "View on TikTok Shop"
          : product.source === "shopify"
            ? "View store page"
            : product.storeUrl
              ? "Open landing page"
              : "Find Supplier on AliExpress";
  const showFindSupplier = product.source !== "nexscope_api" && !mainIsSupplierSearch;
  const supplierSearchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.title.slice(0, 80))}`;

  return (
    <MotionConfig reducedMotion="user">
    {/* Phones get extra bottom room for the sticky action bar. */}
    <div className="p-5 pb-24 sm:pb-5 lg:p-8 max-w-6xl mx-auto">
      {/* Back */}
      <Link
        to="/dashboard/products"
        onClick={(e) => {
          if (!hasHistory) return;
          e.preventDefault();
          navigate(-1);
        }}
        className="inline-flex items-center gap-1.5 h-10 sm:h-auto text-sm text-muted-foreground hover:text-foreground mb-6 cursor-pointer transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {hasHistory ? "Back" : "Back to all products"}
      </Link>

      {/* Phones stack photos → summary → calculator → details (the left column is
          `contents` there, so its two parts take their own places); on desktop the
          images take the left column and summary + details the right one. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_1fr] gap-x-8 gap-y-5">
        {/* Summary: title, AdSpy score, verdict, actions */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-5 lg:col-start-2 lg:row-start-1"
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
                  Real Amazon listing
                </span>
              )}
              {product.source === "tiktok_shop" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  TikTok Shop best-seller
                </span>
              )}
              {product.source === "shopify" && (
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full border border-primary/20">
                  Shopify store running Facebook ads
                </span>
              )}
            </div>
            <div className="flex items-start gap-4 mb-2">
              {/* Marketplace titles can run 8 lines on a phone: 3 there, all of it from sm up. */}
              <h1 className="flex-1 min-w-0 text-2xl font-bold leading-tight line-clamp-3 sm:line-clamp-none" title={product.title}>
                {product.title}
              </h1>
              {/* Main action; phones have it in the bottom bar */}
              <div className="hidden sm:block shrink-0">
                <LaunchDialog product={product} />
              </div>
            </div>
            {product.aliases?.length ? (
              <p className="text-xs text-muted-foreground mb-2">Also listed as {product.aliases.slice(0, 3).join(", ")}</p>
            ) : null}
            <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
          </div>

          {/* Secondary actions (phones: the bar's More menu) */}
          <div className="hidden sm:flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href={product.supplierUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                {viewLabel}
              </a>
            </Button>
            {showFindSupplier && (
              <Button asChild variant="outline">
                <a href={supplierSearchUrl} target="_blank" rel="noopener noreferrer">
                  Find supplier
                </a>
              </Button>
            )}
            <AddToShopify product={product} />
            <Authenticated>
              <SaveButtonDetail productId={product._id} />
              <AddToCollection kind="product" refId={product._id} />
            </Authenticated>
            <FollowProduct productId={product._id} />
          </div>

          <ProductHeadline product={product} />

          <VerdictPanel product={product} />
        </motion.div>

        {/* Left: image + ad examples */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="contents lg:block lg:col-start-1 lg:row-start-1 lg:row-span-2"
        >
          <div className="order-first lg:order-none">
            <ProductGallery product={product} />
          </div>
          <div>
          {/* Profit calculator, under the images */}
          <div id="profit-calculator" className="scroll-mt-20 mb-6">
            <ProfitCalculator basePrice={product.price ?? 0} baseCost={product.cost ?? 0} />
          </div>
          {product.adExamples.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Ad examples</h3>
              <div className="space-y-2">
                {product.adExamples.map((ad, i) => (
                  <div key={i} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
                    <img width={48} height={48}
                      src={ad.imageUrl}
                      alt={`Ad ${i + 1}`}
                      className="w-12 h-12 rounded-md object-cover"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{ad.platform}</div>
                      <div className="text-xs text-muted-foreground">{/^\d+$/.test(ad.impressions) ? compactNumber(Number(ad.impressions)) : ad.impressions} impressions</div>
                    </div>
                    <BarChart3 className="w-4 h-4 text-primary" />
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </motion.div>

        {/* Right: details */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-5 lg:col-start-2 lg:row-start-2 self-start"
        >
          <SourceAgreement product={product} />

          {/* AdSpy score */}
          <div id="demand" className="bg-card border border-border rounded-xl p-4 scroll-mt-20">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-foreground flex flex-col items-center justify-center shrink-0">
                <span className="font-display text-2xl font-bold leading-none text-background">{product.aiScore}</span>
                <span className="text-xs text-background/70 mt-0.5">of 100</span>
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

          {product.saturationByCountry && product.saturationByCountry.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-1">Competition this week</h3>
              <p className="text-xs text-muted-foreground mb-3">Different advertisers running ads for it in each country over the last 7 days, from our own ad data.</p>
              <div className="flex flex-wrap gap-1.5">
                {product.saturationByCountry.map((c) => (
                  <span key={c.country} className={cn("text-xs px-2 py-1 rounded-md border", saturationColors[c.level] ?? "border-border")}>
                    {flag(c.country)} {c.country} · {c.advertisers} advertiser{c.advertisers === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            </div>
          )}

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
                      {product.costSource === "aliexpress" ? (
                        product.costUrl ? (
                          <a href={product.costUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">AliExpress landed cost (est.)</a>
                        ) : (
                          "AliExpress landed cost (est.)"
                        )
                      ) : product.source === "nexscope_api" ? (
                        "Est. supplier cost"
                      ) : (
                        "Supplier cost"
                      )}
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

          <div id="suppliers" className="scroll-mt-20 empty:hidden">
            <SuppliersSection product={product} />
          </div>

          <MarketsSection product={product} />

          <YoutubeSection product={product} />

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {product.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
          </div>
        </motion.div>
      </div>

      {/* AI tools, two side by side */}
      <div className="mt-8">
        <AIToolsGrid product={product} subject={product} />
      </div>

      <ProductPerformance product={product} />

      {/* Phone action bar, sitting just above the dashboard's bottom nav */}
      <div className="sm:hidden fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 border-t border-border bg-background/95 backdrop-blur px-4 py-2">
        <div className="flex-1 min-w-0 [&>button]:w-full [&>button]:h-10">
          <LaunchDialog product={product} />
        </div>
        <Authenticated>
          <SaveButtonDetail productId={product._id} iconOnly />
        </Authenticated>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="More actions">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-60">
            <DropdownMenuItem asChild>
              <a href={product.supplierUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
                {viewLabel}
              </a>
            </DropdownMenuItem>
            {showFindSupplier && (
              <DropdownMenuItem asChild>
                <a href={supplierSearchUrl} target="_blank" rel="noopener noreferrer">
                  <Search className="w-4 h-4" />
                  Find supplier
                </a>
              </DropdownMenuItem>
            )}
            <Authenticated>
              <DropdownMenuItem onSelect={() => setQuickAddOpen(true)}>
                <ShoppingBag className="w-4 h-4" />
                Quick add to Shopify (no AI)
              </DropdownMenuItem>
            </Authenticated>
            <FollowMenuItem productId={product._id} />
          </DropdownMenuContent>
        </DropdownMenu>
        <AddToShopify product={product} dialogOnly open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      </div>
    </div>
    </MotionConfig>
  );
}
