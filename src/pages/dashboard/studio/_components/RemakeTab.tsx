import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import AdVideoAnalysis from "../../ad-spy/_components/AdVideoAnalysis.tsx";

// AI Studio → Remake an ad: the ad's AI tools (Why this video works, Write my version, Voice-over, Make the video),
// moved here from the ad page. A broken ?ad= link (not an ad id) makes the query throw; it shows "Ad not found".

const NotFound = () => <p className="text-sm text-muted-foreground">Ad not found</p>;

class AdBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <NotFound /> : this.props.children;
  }
}

function RemakeAd({ adId }: { adId: string }) {
  const ad = useQuery(api.ads.getById, { id: adId as Id<"ads"> });
  if (ad === undefined) return <Skeleton className="h-40 w-full" />;
  if (!ad) return <NotFound />;
  return (
    <div>
      <div className="mb-4">
        <Link to={`/dashboard/ads/${ad._id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the ad
        </Link>
        <h2 className="text-lg font-semibold mt-1">{ad.headline || ad.advertiserName}</h2>
        {ad.headline && <p className="text-sm text-muted-foreground">{ad.advertiserName}</p>}
      </div>
      {ad.videoUrl || ad.hostedVideoUrl ? (
        <AdVideoAnalysis ad={ad} />
      ) : (
        <p className="text-sm text-muted-foreground">This ad has no video to remake.</p>
      )}
    </div>
  );
}

export default function RemakeTab({ adId }: { adId: string | null }) {
  if (!adId) return <p className="text-sm text-muted-foreground">Open an ad in Ad Spy and click Open in AI Studio to remake it here.</p>;
  return (
    <AdBoundary key={adId}>
      <RemakeAd adId={adId} />
    </AdBoundary>
  );
}
