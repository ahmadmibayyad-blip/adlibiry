import { Authenticated, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { BellPlus, BellRing } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";

const THRESHOLDS = [70, 80, 90];
const message = (e: unknown) => (e instanceof ConvexError ? (e.data as { message: string }).message : "Couldn't update the alert");

// Pro: follow a product for an alert (in-app and in the morning email) when
// new ads appear for it, and optionally when its score reaches a number.
function FollowProductControls({ productId }: { productId: Id<"products"> }) {
  const follow = useQuery(api.follows.productFollow, { productId });
  const followProduct = useMutation(api.follows.followProduct);
  const unfollow = useMutation(api.follows.unfollowProduct);
  if (follow === undefined) return null;
  if (!follow) {
    return (
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await followProduct({ productId });
            toast.success("Following. You'll get an alert when new ads appear for it.");
          } catch (e) {
            toast.error(message(e));
          }
        }}
      >
        <BellPlus className="w-4 h-4 mr-2" />
        Follow
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" className="border-primary/50 text-primary" onClick={() => unfollow({ productId }).then(() => toast.success("Unfollowed"))}>
        <BellRing className="w-4 h-4 mr-2" />
        Following
      </Button>
      <select
        aria-label="Alert me when the score reaches"
        value={follow.minScore ?? ""}
        onChange={async (e) => {
          try {
            await followProduct({ productId, minScore: e.target.value ? Number(e.target.value) : undefined });
            toast.success(e.target.value ? `You'll be told when it reaches ${e.target.value}` : "Score alert off");
          } catch (err) {
            toast.error(message(err));
          }
        }}
        className="h-9 rounded-md border border-border bg-background px-2 text-xs"
      >
        <option value="">No score alert</option>
        {THRESHOLDS.map((t) => (
          <option key={t} value={t}>Score reaches {t}</option>
        ))}
      </select>
    </div>
  );
}

export default function FollowProduct({ productId }: { productId: Id<"products"> }) {
  return (
    <Authenticated>
      <FollowProductControls productId={productId} />
    </Authenticated>
  );
}
