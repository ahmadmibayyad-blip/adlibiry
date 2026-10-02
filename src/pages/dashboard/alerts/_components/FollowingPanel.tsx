import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Skeleton } from "@/components/ui/skeleton.tsx";

// Advertisers the user follows (convex/follows.ts), with unfollow.
export default function FollowingPanel() {
  const following = useQuery(api.follows.listFollowing, {});
  const toggle = useMutation(api.follows.toggleFollow);
  if (following === undefined) return <Skeleton className="h-24 rounded-xl" />;
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-sm flex items-center gap-1.5 mb-1">
        <BellRing className="w-4 h-4 text-primary" />
        Following ({following.length})
      </h2>
      {following.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Open any ad and click <strong>Follow</strong> next to the advertiser. You'll get one alert a day when they launch new ads.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">You get an alert when these advertisers launch new ads.</p>
          <div className="flex flex-wrap gap-2">
            {following.map((f) => (
              <div key={f._id} className="flex items-center gap-2 pl-1 pr-1 h-9 rounded-full border border-border bg-muted/50 max-w-full">
                {f.avatar ? (
                  <img src={f.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                    {f.name.charAt(0).toUpperCase()}
                  </span>
                )}
                {f.latestAdId ? (
                  <Link to={`/dashboard/ads/${f.latestAdId}`} className="text-sm font-medium truncate hover:underline">
                    {f.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium truncate">{f.name}</span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">{f.adCount >= 100 ? "100+" : f.adCount} ads</span>
                <button
                  type="button"
                  title={`Unfollow ${f.name}`}
                  onClick={async () => {
                    await toggle({ name: f.name });
                    toast.success(`Unfollowed ${f.name}`);
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
