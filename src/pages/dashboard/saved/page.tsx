import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Bookmark, Package, Megaphone, Folder } from "lucide-react";
import { useState } from "react";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import AdCard, { AdCardSkeleton } from "../ad-spy/_components/AdCard.tsx";
import AdDetailModal from "../ad-spy/_components/AdDetailModal.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Link, useSearchParams } from "react-router-dom";
import Collections from "./_components/Collections.tsx";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";

type Ad = Doc<"ads">;
type Tab = "products" | "ads" | "collections";

export default function SavedProducts() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.has("collection") ? "collections" : ((params.get("tab") as Tab | null) ?? "products");
  const setTab = (t: Tab) => setParams(t === "products" ? {} : { tab: t });
  const savedProducts = useQuery(api.products.getSaved, {});
  const savedAds = useQuery(api.ads.getSavedAds, {});
  const collections = useQuery(api.collections.mine, {});
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const tabs: { id: Tab; label: string; icon: typeof Package; count: number | undefined }[] = [
    { id: "products", label: "Products", icon: Package, count: savedProducts?.length },
    { id: "ads", label: "Ads", icon: Megaphone, count: savedAds?.length },
    { id: "collections", label: "Collections", icon: Folder, count: collections?.length },
  ];

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Bookmark className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Saved</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Products and ads you've bookmarked, and your own collections of ads, stores and products.
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.count !== undefined && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "collections" ? (
        <Collections />
      ) : tab === "products" ? (
        savedProducts === undefined ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : savedProducts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Package />
              </EmptyMedia>
              <EmptyTitle>No saved products yet</EmptyTitle>
              <EmptyDescription>
                Browse the winning products feed and bookmark ones you want to research later.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild size="sm">
                <Link to="/dashboard/winners">Browse Winning Products</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {savedProducts.map((product, i) => (
              <motion.div
                key={product?._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                {product && <ProductCard product={product} />}
              </motion.div>
            ))}
          </div>
        )
      ) : savedAds === undefined ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <AdCardSkeleton key={i} />
          ))}
        </div>
      ) : savedAds.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>No saved ads yet</EmptyTitle>
            <EmptyDescription>
              Browse Ad Spy and bookmark winning creatives for your swipe file.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild size="sm">
              <Link to="/dashboard/ad-spy">Browse Ad Spy</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {savedAds.map((ad, i) => (
            <motion.div
              key={ad?._id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
            >
              {ad && (
                <AdCard
                  ad={ad}
                  onClick={() => {
                    setSelectedAd(ad);
                    setModalOpen(true);
                  }}
                />
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AdDetailModal ad={selectedAd} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
