import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Copy } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { compactNumber, flag, shortDate } from "@/lib/adFormat.ts";

// Other ads running the same creative (convex/ads.ts sameCreative): who else
// copies this image, in which countries, and for how long. One row per ad.
export default function SameCreative({ adId, compact = false }: { adId: Id<"ads">; compact?: boolean }) {
  const result = useQuery(api.ads.sameCreative, { adId });
  if (!result) return null;

  const heading = (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Copy className="w-4 h-4 text-primary" />
      Same creative elsewhere
      {result.total > 0 && (
        <span className="font-normal text-muted-foreground">
          · {result.total} ad{result.total === 1 ? "" : "s"}
          {result.advertisers > 0 && `, ${result.advertisers} other advertiser${result.advertisers === 1 ? "" : "s"}`}
        </span>
      )}
    </div>
  );

  const note =
    result.status === "pending"
      ? "We haven't read this ad's image yet. Check back after tonight's update."
      : result.status === "unreadable"
        ? "This ad's image couldn't be read, so it can't be matched."
        : result.total === 0
          ? "No other ad we track uses this image."
          : null;

  return (
    <div className={compact ? "bg-card border border-border rounded-xl p-3.5 space-y-2" : "bg-card border border-border rounded-xl p-4 space-y-3"}>
      {heading}
      {note ? (
        <p className="text-xs text-muted-foreground">{note}</p>
      ) : (
        <ul className="divide-y divide-border">
          {result.ads.slice(0, compact ? 5 : undefined).map((a) => {
            const views = a.impressions ? compactNumber(a.impressions) : a.views && a.views !== "0" ? a.views : undefined;
            return (
              <li key={a._id}>
                <Link to={`/dashboard/ads/${a._id}`} className="flex items-center gap-3 py-2 text-xs hover:bg-muted/50 rounded -mx-1 px-1">
                  {a.creativeUrl ? (
                    <img src={a.creativeUrl} alt="" loading="lazy" className="w-9 h-9 rounded object-cover shrink-0 bg-muted" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-muted shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.advertiserName}</div>
                    <div className="text-muted-foreground truncate">
                      {flag(a.country)} {a.country} · {a.platform}
                      {a.daysRunning > 0 && ` · ${a.daysRunning} days`}
                      {!compact && ` · since ${shortDate(a.firstSeenAt)}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {views ? <div className="tabular-nums font-medium">{views}</div> : null}
                    <div className={a.isActive === false ? "text-muted-foreground" : "text-green-500"}>{a.isActive === false ? "Stopped" : "Live"}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {compact && result.ads.length > 5 && (
        <p className="text-xs text-muted-foreground">Open the ad page to see all {result.total}.</p>
      )}
    </div>
  );
}
