import { useRef, useState } from "react";
import { useMutation, useQuery, Authenticated } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import {
  Heart, Eye, MessageCircle, Share2, Bookmark, BookmarkCheck, Play, Layers, Calendar, Copy, Zap, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { compactNumber, flag, shortDate, domainOf, spendLabel } from "@/lib/adFormat.ts";

type Ad = Doc<"ads">;

const platformStyle: Record<string, string> = {
  Facebook: "bg-blue-500/15 text-blue-400",
  Instagram: "bg-pink-500/15 text-pink-400",
  TikTok: "bg-foreground/10 text-foreground",
  Amazon: "bg-orange-500/15 text-orange-400",
};

function scoreColor(score: number) {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-muted-foreground";
}

function SaveAdButton({ adId }: { adId: Ad["_id"] }) {
  const isSaved = useQuery(api.ads.isAdSaved, { adId });
  const toggleSave = useMutation(api.ads.toggleSaveAd);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const r = await toggleSave({ adId });
          toast.success(r.saved ? "Saved to your creative library" : "Removed from saved");
        } catch {
          toast.error("Please sign in to save ads");
        }
      }}
      className={cn(
        "p-1.5 rounded-md transition-colors cursor-pointer",
        isSaved ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      title={isSaved ? "Remove from saved" : "Save ad"}
    >
      {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
    </button>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Eye; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5" title={label}>
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function AdCard({ ad, onClick }: { ad: Ad; onClick: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const isVideo = !!ad.videoUrl || ad.mediaType === "video";
  const spend = spendLabel(ad.spendEstimate);
  const countries = (ad.countries?.length ? ad.countries : ad.country && ad.country !== "INTL" ? [ad.country] : []).slice(0, 4);
  const moreCountries = (ad.countries?.length ?? 0) - countries.length;
  const domain = domainOf(ad.landingPageUrl);
  const text = ad.bodyText || ad.headline;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onMouseEnter={() => {
        setHovering(true);
        if (ad.videoUrl) setTimeout(() => videoRef.current?.play().catch(() => {}), 50);
      }}
      onMouseLeave={() => {
        setHovering(false);
        videoRef.current?.pause();
      }}
      className="group text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors cursor-pointer w-full flex flex-col"
    >
      {/* Advertiser header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {ad.advertiserAvatar ? (
          <img src={ad.advertiserAvatar} alt="" className="w-8 h-8 rounded-full object-cover bg-muted shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
            {ad.advertiserName.replace(/^(https?:\/\/)?(www\.)?/, "").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">{ad.advertiserName}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("px-1.5 rounded", platformStyle[ad.platform] ?? "bg-muted")}>{ad.platform}</span>
            {ad.isActive !== undefined && (
              <span className="flex items-center gap-1">
                <span className={cn("w-1.5 h-1.5 rounded-full", ad.isActive ? "bg-green-400" : "bg-muted-foreground/50")} />
                {ad.isActive ? "Active" : "Inactive"}
              </span>
            )}
          </div>
        </div>
        <Authenticated>
          <SaveAdButton adId={ad._id} />
        </Authenticated>
      </div>

      {/* Media */}
      <div className="relative aspect-[4/5] bg-muted overflow-hidden">
        {ad.videoUrl && hovering ? (
          <video
            ref={videoRef}
            src={ad.videoUrl}
            poster={ad.creativeUrl}
            muted
            loop
            playsInline
            preload="none"
            className="w-full h-full object-cover"
          />
        ) : !imgFailed && ad.creativeUrl ? (
          <img
            src={ad.creativeUrl}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
            {ad.headline}
          </div>
        )}
        {isVideo && !hovering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          <span className="flex items-center gap-1 bg-black/65 text-white text-[11px] font-medium rounded-md px-1.5 py-0.5">
            <Calendar className="w-3 h-3" />
            {ad.daysRunning > 0 ? `${ad.daysRunning}d` : "New"}
          </span>
          {(ad.relatedAdsCount ?? 0) > 1 && (
            <span className="flex items-center gap-1 bg-primary/90 text-primary-foreground text-[11px] font-semibold rounded-md px-1.5 py-0.5" title="Ad copies running with this creative — a scaling signal">
              <Copy className="w-3 h-3" />×{ad.relatedAdsCount}
            </span>
          )}
          {ad.mediaType === "carousel" && (
            <span className="flex items-center gap-1 bg-black/65 text-white text-[11px] rounded-md px-1.5 py-0.5">
              <Layers className="w-3 h-3" />
            </span>
          )}
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/65 rounded-md px-1.5 py-0.5" title="Winning score">
          <Zap className="w-3 h-3 text-primary" />
          <span className={cn("text-[11px] font-bold", scoreColor(ad.aiScore))}>{ad.aiScore}</span>
        </div>
        {spend && (
          <div className="absolute bottom-2 left-2 bg-black/65 text-white text-[11px] font-semibold rounded-md px-1.5 py-0.5" title="Estimated ad spend">
            {spend}
          </div>
        )}
      </div>

      {/* Copy */}
      <div className="px-3 pt-2.5">
        <p className="text-xs leading-snug line-clamp-2 min-h-[2.1rem]">{text}</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 mx-3 mt-2 rounded-lg bg-muted/60">
        <Metric icon={Eye} value={ad.impressions ? compactNumber(ad.impressions) : ad.views && ad.views !== "0" ? ad.views : "—"} label="Impressions" />
        <Metric icon={Heart} value={ad.likes > 0 ? compactNumber(ad.likes) : "—"} label="Likes" />
        <Metric icon={MessageCircle} value={compactNumber(ad.comments)} label="Comments" />
        <Metric icon={Share2} value={compactNumber(ad.shares)} label="Shares" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 mt-auto text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1 min-w-0">
          <span title="First seen">{shortDate(ad.firstSeenAt)}</span>
          {countries.length > 0 && (
            <span className="ml-1 truncate" title={(ad.countries ?? [ad.country]).join(", ")}>
              {countries.map(flag).join(" ")}
              {moreCountries > 0 ? ` +${moreCountries}` : ""}
            </span>
          )}
        </div>
        {ad.ctaText ? (
          <span className="shrink-0 max-w-[50%] truncate border border-border rounded-md px-1.5 py-0.5 text-foreground">{ad.ctaText}</span>
        ) : domain ? (
          <span className="shrink-0 flex items-center gap-1 truncate max-w-[55%]">
            <ExternalLink className="w-3 h-3" />
            {domain}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function AdCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="flex items-center gap-2 p-3">
        <div className="w-8 h-8 rounded-full bg-muted" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-muted rounded w-2/3" />
          <div className="h-2.5 bg-muted rounded w-1/3" />
        </div>
      </div>
      <div className="aspect-[4/5] bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-4/5" />
        <div className="h-9 bg-muted rounded" />
      </div>
    </div>
  );
}
