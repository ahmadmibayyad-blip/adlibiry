import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { ShoppingBag } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import MyNichesChip from "@/components/MyNichesChip.tsx";
import { useMyNiches } from "@/hooks/use-my-niches.ts";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import TrialLimitNotice from "../_components/TrialLimitNotice.tsx";

// TikTok Shop best-sellers (roadmap P2-C), ranked by estimated monthly sales
// from TikTok Shop's own daily sales counts (Nexscope data, refreshed daily).
export default function TikTokShopPage() {
  const { niches } = useMyNiches();
  const [useMine, setUseMine] = useState(true);
  const args = useMine && niches.length ? { niches } : {};
  const { results, status, loadMore } = usePaginatedQuery(api.products.tiktokShop, args, { initialNumItems: 24 });

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <ShoppingBag className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">TikTok Shop</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Best-selling TikTok Shop products, ranked by estimated sales per month from the shop's own daily sales counts. Updated every
            morning.
          </p>
        </div>
        <MyNichesChip niches={niches} on={useMine && niches.length > 0} onToggle={() => setUseMine(!useMine)} />
      </div>
      <TrialLimitNotice />

      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <h3 className="font-semibold mb-1">No TikTok Shop products yet</h3>
          <p className="text-sm text-muted-foreground">They're imported every morning. Try turning off "My niches".</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {results.map((p) => (
              <ProductCard key={p._id} product={p} />
            ))}
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={() => loadMore(24)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
