import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Download } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

// AI Studio → My videos: finished UGC videos and Playground clips (studio.mine), newest first, 30 more per "Show more".

const PAGE = 30;

export default function MyVideos() {
  const [limit, setLimit] = useState(PAGE);
  const videos = useQuery(api.studio.mine, limit === PAGE ? {} : { limit });
  if (videos === undefined) return <Skeleton className="h-40 w-full" />;
  if (!videos.length) return <p className="text-sm text-muted-foreground">Your AI videos and clips will show here.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {videos.map((v) => (
          <div key={v.id}>
            <video controls preload="metadata" src={v.videoUrl} className="w-full rounded-lg bg-black aspect-[9/16] object-contain" />
            <p className="text-sm mt-1.5 line-clamp-2">{v.title}</p>
            <p className="text-xs text-muted-foreground">
              {v.kind === "ugc" ? "UGC video" : "Clip"} · {new Date(v.at).toLocaleDateString()}
              {v.adId && (
                <>
                  {" · "}
                  <Link to={`/dashboard/ads/${v.adId}`} className="underline underline-offset-2">
                    ad
                  </Link>
                </>
              )}
            </p>
            <Button asChild variant="outline" size="sm" className="h-8 mt-1.5">
              <a href={v.videoUrl} download={v.kind === "ugc" ? "ai-ad.mp4" : "ai-clip.mp4"}>
                <Download className="w-3.5 h-3.5 mr-1" />
                Download MP4
              </a>
            </Button>
          </div>
        ))}
      </div>
    {videos.length >= limit && (
      <Button variant="outline" size="sm" className="mt-4" onClick={() => setLimit((l) => l + PAGE)}>
        Show more
      </Button>
    )}
    </div>
  );
}
