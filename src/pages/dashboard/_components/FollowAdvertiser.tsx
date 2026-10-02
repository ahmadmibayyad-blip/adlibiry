import { Authenticated, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { BellPlus, BellRing } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

// Follow an advertiser: one alert a day when they launch new ads (convex/follows.ts).
function FollowButton({ name, className }: { name: string; className?: string }) {
  const following = useQuery(api.follows.isFollowing, { name });
  const toggle = useMutation(api.follows.toggleFollow);
  return (
    <Button
      size="sm"
      variant={following ? "outline" : "secondary"}
      className={cn("h-7 px-2.5", following && "border-primary/50 text-primary", className)}
      onClick={async () => {
        try {
          const r = await toggle({ name });
          toast.success(r.following ? `Following ${name}. You'll get an alert when they launch new ads.` : `Unfollowed ${name}`);
        } catch (e) {
          toast.error(e instanceof ConvexError ? (e.data as { message: string }).message : "Couldn't update follow");
        }
      }}
    >
      {following ? <BellRing className="w-3.5 h-3.5 mr-1" /> : <BellPlus className="w-3.5 h-3.5 mr-1" />}
      {following ? "Following" : "Follow"}
    </Button>
  );
}

export default function FollowAdvertiser(props: { name: string; className?: string }) {
  return (
    <Authenticated>
      <FollowButton {...props} />
    </Authenticated>
  );
}
