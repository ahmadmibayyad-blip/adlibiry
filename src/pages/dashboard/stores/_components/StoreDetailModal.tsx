import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  ExternalLink, Bookmark, BookmarkCheck, TrendingUp, DollarSign, Users, Megaphone, Info,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Authenticated, Unauthenticated } from "convex/react";
import { storeImage } from "@/lib/storeImage.ts";
import StoreSales from "./StoreSales.tsx";
import ProductImage from "@/components/ProductImage.tsx";
import { storeRevenueLabel } from "@/lib/estimateFormat.ts";

type StoreDoc = Doc<"stores">;

export default function StoreDetailModal({ store, open, onOpenChange }: { store: StoreDoc | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isTracked = useQuery(api.stores.isStoreTracked, store ? { storeId: store._id } : "skip");
  const toggleTrack = useMutation(api.stores.toggleTrackStore);

  if (!store) return null;

  const handleTrack = async () => {
    try {
      const result = await toggleTrack({ storeId: store._id });
      toast.success(result.tracked ? "Store added to watchlist!" : "Removed from watchlist");
    } catch {
      toast.error("Please sign in to track stores");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{store.name}</DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-4 mb-4">
          <img src={storeImage(store)} alt={store.name} className="w-16 h-16 rounded-xl object-cover border border-border" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold leading-tight mb-1">{store.name}</h2>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border">{store.niche}</span>
              <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border">{store.country}</span>
              <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border">{store.platform}</span>
              {store.isHighTraffic && (
                <span className="flex items-center gap-1 bg-green-400/10 text-green-400 px-2 py-0.5 rounded-full border border-green-400/20">
                  <TrendingUp className="w-3 h-3" />
                  High Traffic
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-muted rounded-lg p-3 flex flex-col items-center text-center gap-1">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <div className="text-sm font-bold">{storeRevenueLabel(store) ?? "Tracking"}</div>
            <div className="text-[11px] text-muted-foreground">
              Est. revenue{store.revenueConfidence ? ` · ${store.revenueConfidence} confidence` : ""}
            </div>
          </div>
          <div className="bg-muted rounded-lg p-3 flex flex-col items-center text-center gap-1">
            <Users className="w-4 h-4 text-muted-foreground" />
            <div className="text-sm font-bold">{store.trafficRange}</div>
            <div className="text-[11px] text-muted-foreground">Traffic</div>
          </div>
          <div className="bg-muted rounded-lg p-3 flex flex-col items-center text-center gap-1">
            <Megaphone className="w-4 h-4 text-muted-foreground" />
            <div className="text-sm font-bold">{store.activeAdsCount}</div>
            <div className="text-[11px] text-muted-foreground">Active ads</div>
          </div>
        </div>

        <StoreSales storeId={store._id} />

        <div className="mb-5">
          <h3 className="font-semibold text-sm mb-3">Best Sellers</h3>
          <div className="space-y-2.5">
            {store.bestSellers.map((product) => (
              <div key={product.title} className="flex items-center gap-3 bg-muted rounded-lg p-2.5">
                <ProductImage src={product.imageUrl} alt={product.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-snug line-clamp-1">{product.title}</div>
                  <div className="text-xs text-muted-foreground">{product.estSalesRange}</div>
                </div>
                <div className="text-sm font-bold shrink-0">${product.price.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 mb-4">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Revenue, traffic, and sales figures are honest ranged estimates based on public storefront signals — never precise numbers we can't back up.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button asChild className="flex-1">
            <a href={store.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Visit Store
            </a>
          </Button>
          <Authenticated>
            <Button variant="outline" onClick={handleTrack} className={cn(isTracked ? "border-primary/50 text-primary" : "")}>
              {isTracked ? (
                <><BookmarkCheck className="w-4 h-4 mr-2" />Tracking</>
              ) : (
                <><Bookmark className="w-4 h-4 mr-2" />Track Store</>
              )}
            </Button>
          </Authenticated>
          <Unauthenticated>
            <Button variant="outline" onClick={() => toast.error("Please sign in to track stores")}>
              <Bookmark className="w-4 h-4 mr-2" />
              Track Store
            </Button>
          </Unauthenticated>
        </div>
      </DialogContent>
    </Dialog>
  );
}
