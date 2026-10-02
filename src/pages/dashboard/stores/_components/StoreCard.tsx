import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Store, TrendingUp, Megaphone, Bookmark, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { storeImage } from "@/lib/storeImage.ts";

type StoreDoc = Doc<"stores">;

function TrackButton({ storeId }: { storeId: StoreDoc["_id"] }) {
  const isTracked = useQuery(api.stores.isStoreTracked, { storeId });
  const toggleTrack = useMutation(api.stores.toggleTrackStore);

  const handleTrack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await toggleTrack({ storeId });
      toast.success(result.tracked ? "Store added to watchlist!" : "Removed from watchlist");
    } catch {
      toast.error("Please sign in to track stores");
    }
  };

  return (
    <button
      onClick={handleTrack}
      className={cn(
        "p-2 rounded-lg border border-border transition-all cursor-pointer",
        isTracked
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-background/80 text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
      title={isTracked ? "Remove from watchlist" : "Track store"}
    >
      {isTracked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
    </button>
  );
}

export default function StoreCard({
  store,
  onClick,
  compareSelected,
  onToggleCompare,
}: {
  store: StoreDoc;
  onClick: () => void;
  compareSelected?: boolean;
  onToggleCompare?: () => void;
}) {
  return (
    <div className="group bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all">
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <img
          src={storeImage(store)}
          alt={store.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 cursor-pointer"
          onClick={onClick}
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-lg px-2 py-1 border border-border">
          <Store className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-medium">{store.platform}</span>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {onToggleCompare && (
            <div
              className="bg-background/90 backdrop-blur-sm rounded-lg p-1.5 border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox checked={compareSelected} onCheckedChange={onToggleCompare} className="cursor-pointer" />
            </div>
          )}
          <Authenticated>
            <TrackButton storeId={store._id} />
          </Authenticated>
        </div>
        {store.isHighTraffic && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-green-400/90 text-black text-[11px] font-semibold px-2 py-0.5 rounded-md">
            <TrendingUp className="w-3 h-3" />
            High Traffic
          </div>
        )}
      </div>

      <button onClick={onClick} className="w-full text-left p-4 cursor-pointer">
        <h3 className="font-semibold text-sm mb-1">{store.name}</h3>
        <div className="text-xs text-muted-foreground mb-3">{store.niche} · {store.country}</div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="font-semibold">{store.estimatedRevenueRange}</div>
            <div className="text-[11px] text-muted-foreground">Est. revenue</div>
          </div>
          <div>
            <div className="font-semibold">{store.trafficRange}</div>
            <div className="text-[11px] text-muted-foreground">Traffic</div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
          <Megaphone className="w-3.5 h-3.5" />
          {store.activeAdsCount} ads currently running
        </div>
      </button>
    </div>
  );
}

export function StoreCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-[16/10] bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-muted rounded w-2/3" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-3 bg-muted rounded" />
          <div className="h-3 bg-muted rounded" />
        </div>
      </div>
    </div>
  );
}
