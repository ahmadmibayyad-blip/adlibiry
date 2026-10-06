import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { X, DollarSign, Users, Megaphone, TrendingUp } from "lucide-react";
import { storeImage } from "@/lib/storeImage.ts";
import { storeRevenueLabel } from "@/lib/estimateFormat.ts";

type StoreDoc = Doc<"stores">;

export default function StoreCompareModal({
  storeIds,
  open,
  onOpenChange,
  onRemove,
}: {
  storeIds: Array<StoreDoc["_id"]>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (id: StoreDoc["_id"]) => void;
}) {
  const stores = useQuery(api.stores.getByIds, storeIds.length > 0 ? { ids: storeIds } : "skip");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare Stores</DialogTitle>
        </DialogHeader>

        {stores === undefined ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
        ) : stores.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Select stores to compare using the checkboxes on store cards.</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stores.length}, minmax(0, 1fr))` }}>
            {stores.map((store) =>
              store ? (
                <div key={store._id} className="bg-card border border-border rounded-xl p-4 relative">
                  <button
                    onClick={() => onRemove(store._id)}
                    className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <img src={storeImage(store)} alt={store.name} className="w-12 h-12 rounded-lg object-cover mb-2.5" />
                  <h3 className="font-semibold text-sm mb-0.5 pr-6">{store.name}</h3>
                  <div className="text-xs text-muted-foreground mb-3">{store.niche} · {store.country}</div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-semibold">{storeRevenueLabel(store) ?? "Tracking"}</div>
                        <div className="text-[10px] text-muted-foreground">Est. revenue</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-semibold">{store.trafficRange}</div>
                        <div className="text-[10px] text-muted-foreground">Traffic</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Megaphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-semibold">{store.activeAdsCount}</div>
                        <div className="text-[10px] text-muted-foreground">Active ads</div>
                      </div>
                    </div>
                    {store.isHighTraffic && (
                      <div className="flex items-center gap-1 text-green-400 font-medium">
                        <TrendingUp className="w-3.5 h-3.5" />
                        High Traffic
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Top seller</div>
                    <div className="text-xs font-medium line-clamp-2">{store.bestSellers[0]?.title ?? "—"}</div>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
