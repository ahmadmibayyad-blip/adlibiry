import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Heart, Eye, Calendar, Zap, Bookmark, BookmarkCheck, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { toast } from "sonner";
import { Authenticated } from "convex/react";

type Ad = Doc<"ads">;

const platformColors: Record<string, string> = {
  Facebook: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Instagram: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  TikTok: "bg-foreground/10 text-foreground border-foreground/20",
  Amazon: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function scoreColor(score: number) {
  if (score >= 85) return "text-green-400";
  if (score >= 70) return "text-yellow-400";
  return "text-red-400";
}

function SaveAdButton({ adId }: { adId: Ad["_id"] }) {
  const isSaved = useQuery(api.ads.isAdSaved, { adId });
  const toggleSave = useMutation(api.ads.toggleSaveAd);

  const handleSave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await toggleSave({ adId });
      toast.success(result.saved ? "Ad saved to creative library!" : "Removed from saved");
    } catch {
      toast.error("Please sign in to save ads");
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
      title={isSaved ? "Remove from saved" : "Save ad"}
    >
      {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
    </button>
  );
}

export default function AdCard({ ad, onClick }: { ad: Ad; onClick: () => void }) {
  const nexscopeCounts = useQuery(api.products.nexscopeProductCountsByNiche, {});
  const hasAmazonMatch = !!nexscopeCounts && (nexscopeCounts[ad.niche] ?? 0) > 0;

  return (
    <button
      onClick={onClick}
      className="group text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5 cursor-pointer w-full"
    >
      {/* Creative */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={ad.creativeUrl}
          alt={ad.headline}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-lg px-2 py-1 border border-border">
          <Zap className="w-3 h-3 text-primary" />
          <span className={cn("text-xs font-bold", scoreColor(ad.aiScore))}>{ad.aiScore}</span>
        </div>
        <div className="absolute top-2 right-2">
          <Authenticated>
            <SaveAdButton adId={ad._id} />
          </Authenticated>
        </div>
        <div className={cn("absolute bottom-2 left-2 text-[11px] font-medium px-2 py-0.5 rounded-md border", platformColors[ad.platform])}>
          {ad.platform}
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-md px-2 py-0.5 border border-border">
          <Calendar className="w-3 h-3 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">{ad.daysRunning}d</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="text-xs font-semibold text-primary mb-1">{ad.advertiserName}</div>
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 mb-2">{ad.headline}</h3>
        <div className="text-xs text-muted-foreground mb-3">{ad.niche} · {ad.country}</div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <div className="flex items-center gap-1">
            <Heart className="w-3.5 h-3.5" />
            {ad.likes.toLocaleString()}
          </div>
          <div className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" />
            {ad.views}
          </div>
          <div className="font-semibold text-foreground">{ad.spendEstimate}</div>
        </div>

        {hasAmazonMatch && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-md px-2 py-1">
            <ShoppingBag className="w-3 h-3" />
            Real Amazon match found
          </div>
        )}
      </div>
    </button>
  );
}

export function AdCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-muted rounded w-1/3" />
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="flex justify-between">
          <div className="h-3 bg-muted rounded w-10" />
          <div className="h-3 bg-muted rounded w-10" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      </div>
    </div>
  );
}
