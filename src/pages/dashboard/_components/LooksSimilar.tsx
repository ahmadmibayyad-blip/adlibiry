import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import AdCard from "../ad-spy/_components/AdCard.tsx";

type Result = FunctionReturnType<typeof api.adEmbeddings.looksSimilar>;

// Ads whose image looks like this one's (convex/adEmbeddings.ts looksSimilar):
// the same product shot differently, a similar style. Identical copies are
// under "Same creative elsewhere" instead.
export default function LooksSimilar({ adId, compact = false }: { adId: Id<"ads">; compact?: boolean }) {
  const lookup = useAction(api.adEmbeddings.looksSimilar);
  // Kept with the ad it belongs to: while another ad's answer is loading, the old one isn't shown.
  const [state, setState] = useState<{ adId: Id<"ads">; result?: Result; failed?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    lookup({ adId })
      .then((result) => live && setState({ adId, result }))
      .catch(() => live && setState({ adId, failed: true }));
    return () => {
      live = false;
    };
  }, [adId, lookup]);

  const current = state?.adId === adId ? state : null;
  const result = current?.result;
  const failed = !!current?.failed;

  if (result === null) return null;

  const note = failed
    ? "Couldn't look for similar ads right now."
    : result?.status === "pending"
      ? "This ad's image hasn't been read yet. Check back after tomorrow's update."
      : result?.status === "none" || result?.status === "failed"
        ? "This ad has no image we can compare."
        : result && result.ads.length === 0
          ? "No ad we track looks like this one yet."
          : null;
  const ads = result?.ads ?? [];

  return (
    <div className={compact ? "bg-card border border-border rounded-xl p-3.5 space-y-2" : "bg-card border border-border rounded-xl p-4 space-y-3"}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="w-4 h-4 text-primary" />
        Looks similar
        {ads.length > 0 && <span className="font-normal text-muted-foreground">· {ads.length} ads from other creatives</span>}
      </div>
      {result === undefined && !failed ? (
        <div className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"}>
          {Array.from({ length: compact ? 3 : 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : note ? (
        <p className="text-xs text-muted-foreground">{note}</p>
      ) : compact ? (
        <div className="grid grid-cols-3 gap-2">
          {ads.slice(0, 6).map((a) => (
            <Link key={a._id} to={`/dashboard/ads/${a._id}`} className="group block min-w-0" title={a.headline || a.advertiserName}>
              {a.creativeUrl ? (
                <img width={400} height={400} src={a.creativeUrl} alt="" loading="lazy" className="w-full aspect-square rounded-lg object-cover bg-muted group-hover:opacity-80" />
              ) : (
                <div className="w-full aspect-square rounded-lg bg-muted" />
              )}
              <div className="text-xs truncate mt-1 text-muted-foreground group-hover:text-foreground">{a.advertiserName}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ads.map((a) => (
            <AdCard key={a._id} ad={a} href={`/dashboard/ads/${a._id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
