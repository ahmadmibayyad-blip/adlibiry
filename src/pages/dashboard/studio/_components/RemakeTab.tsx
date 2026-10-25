import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useMediaFallback } from "@/lib/useMediaFallback.ts";
import AdVideoAnalysis from "../../ad-spy/_components/AdVideoAnalysis.tsx";

// AI Studio → Remake an ad: the ad's AI tools (Why this video works, Write my version, Voice-over, Make the video),
// moved here from the ad page. studio.ad takes the raw ?ad= text, so a broken link is just "Ad not found".

function AdHeader({ ad }: { ad: Doc<"ads"> }) {
  const image = useMediaFallback(ad.creativeUrl, ad.hostedImageUrl);
  return (
    <div className="mb-4 flex items-start gap-3">
      {!image.failed && <img width={56} height={56} src={image.src} onError={image.onError} alt="" className="w-14 h-14 rounded-lg object-cover bg-muted shrink-0" />}
      <div className="min-w-0">
        <Link to={`/dashboard/ads/${ad._id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the ad
        </Link>
        <h2 className="text-lg font-semibold">{ad.headline || ad.advertiserName}</h2>
        {ad.headline && <p className="text-sm text-muted-foreground">{ad.advertiserName}</p>}
      </div>
    </div>
  );
}

export default function RemakeTab({ adId }: { adId: string | null }) {
  const ad = useQuery(api.studio.ad, adId ? { id: adId } : "skip");
  if (!adId) return <p className="text-sm text-muted-foreground">Open an ad in Ad Spy and click Open in AI Studio to remake it here.</p>;
  if (ad === undefined) return <Skeleton className="h-40 w-full" />;
  if (!ad) return <p className="text-sm text-muted-foreground">Ad not found</p>;
  return (
    <div>
      <AdHeader ad={ad} />
      {ad.videoUrl || ad.hostedVideoUrl ? (
        <AdVideoAnalysis ad={ad} />
      ) : (
        <p className="text-sm text-muted-foreground">This ad has no video to remake.</p>
      )}
    </div>
  );
}
