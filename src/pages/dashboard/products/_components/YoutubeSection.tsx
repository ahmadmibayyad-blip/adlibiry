import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { MonitorPlay } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { recentViews, type ProductVideos } from "@/convex/lib/youtube.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { Spinner } from "@/components/ui/spinner.tsx";

// Product page → On YouTube (convex/youtube.ts): review and unboxing videos about the product and their views,
// looked up once when the page opens and saved for everyone.

const age = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days < 1 ? "today" : days < 30 ? `${days} days ago` : days < 365 ? `${Math.floor(days / 30)} months ago` : `${Math.floor(days / 365)} years ago`;
};

export default function YoutubeSection({ product }: { product: Doc<"products"> }) {
  const { isAuthenticated } = useConvexAuth();
  const lookUp = useAction(api.youtube.productVideosFor);
  const started = useRef<string | null>(null);
  const [searching, setSearching] = useState(false);
  const yt = product.youtube as ProductVideos | undefined;

  useEffect(() => {
    if (!isAuthenticated || product.isService || started.current === product._id) return;
    started.current = product._id;
    setSearching(!yt);
    lookUp({ productId: product._id })
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [isAuthenticated, product._id, product.isService, lookUp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (product.isService || (!yt && !searching)) return null;
  const recent = yt ? recentViews(yt) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm mb-1 flex items-center gap-1.5">
        <MonitorPlay className="w-4 h-4 text-primary" /> On YouTube
      </h3>
      {!yt ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Spinner className="w-3.5 h-3.5" /> Looking for review videos…</p>
      ) : yt.videos.length ? (
        <>
          <p className="text-sm">
            <span className="font-semibold">{compactNumber(yt.totalViews)} views</span> on the top {yt.videos.length} review videos
            {recent ? <span className="text-muted-foreground"> · {compactNumber(recent)} on videos from the last 3 months</span> : null}
          </p>
          <p className="text-xs text-muted-foreground mb-2">People watching reviews means people thinking about buying. Recent views show the interest is still there.</p>
          <ul className="space-y-2">
            {yt.videos.slice(0, 4).map((v) => (
              <li key={v.id}>
                <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="flex gap-3 group">
                  {v.thumbnail ? <img src={v.thumbnail} alt="" className="w-24 h-14 rounded object-cover shrink-0" loading="lazy" /> : null}
                  <span className="min-w-0 text-xs">
                    <span className="block text-sm line-clamp-2 group-hover:underline">{v.title}</span>
                    <span className="text-muted-foreground">{v.channel} · {compactNumber(v.views)} views · {age(v.publishedAt)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No review videos found on YouTube yet: either a new product or one people don't review.</p>
      )}
    </div>
  );
}
