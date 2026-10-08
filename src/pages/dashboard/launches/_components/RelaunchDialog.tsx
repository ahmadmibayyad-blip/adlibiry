import { useState } from "react";
import { useMutation } from "convex/react";
import { Rocket } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { STORE_STYLES, type StoreStyleId } from "@/convex/lib/storeStyles.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import { Progress } from "@/pages/dashboard/products/_components/LaunchDialog.tsx";

// Relaunch (convex/launch.ts relaunch): the same product and settings, with new
// AI photos or supplier reviews; optionally replacing the old launch.

const AI_PHOTO_COUNTS = [0, 2, 4, 6] as const;

export default function RelaunchDialog({ launch, aiPhotosReady, onClose }: { launch: Doc<"launches">; aiPhotosReady: boolean; onClose: () => void }) {
  const relaunch = useMutation(api.launch.relaunch);
  const [aiPhotos, setAiPhotos] = useState<number>(aiPhotosReady ? (launch.aiPhotos ?? 4) : 0);
  const [reviewsUrl, setReviewsUrl] = useState(launch.reviewsUrl ?? "");
  const [replaceOld, setReplaceOld] = useState(!launch.themeLive);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<Id<"launches"> | null>(null);
  const isStore = launch.mode === "store";
  const facts = launch.facts as { shippingTime?: string; returnDays?: number } | undefined;
  const settings = [
    isStore ? `${STORE_STYLES[launch.style as StoreStyleId]?.name ?? "Full"} store “${launch.brandName ?? ""}”` : "Product page",
    launch.language,
    launch.price ? `${launch.price}` : "",
    facts?.shippingTime ?? "",
    facts?.returnDays ? `${facts.returnDays}-day returns` : "",
  ].filter(Boolean);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Relaunch</DialogTitle>
          <DialogDescription>{(launch.copy as { title?: string } | undefined)?.title ?? "This product"}, with the same settings and the extras you pick here.</DialogDescription>
        </DialogHeader>
        {started ? (
          <Progress launchId={started} onAgain={() => setStarted(null)} />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Same settings: {settings.join(" · ")}</p>
            <div className="text-sm">
              <span className="font-medium">AI product photos</span>
              <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label="AI product photos">
                {AI_PHOTO_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={aiPhotos === n}
                    disabled={!aiPhotosReady}
                    onClick={() => setAiPhotos(n)}
                    className={cn(
                      "h-8 min-w-12 rounded-md border px-3 text-sm disabled:opacity-50",
                      aiPhotos === n ? "border-primary bg-primary/10 font-medium text-foreground" : "border-input text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n === 0 ? "None" : n}
                  </button>
                ))}
              </div>
              {!aiPhotosReady && <span className="text-xs text-muted-foreground">AI photos aren't switched on yet.</span>}
            </div>
            {isStore && (
              <label className="block text-sm">
                <span className="font-medium">Supplier reviews</span>
                <textarea
                  value={reviewsUrl}
                  onChange={(e) => setReviewsUrl(e.target.value)}
                  placeholder="AliExpress product links, one per line (up to 3), optional"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            )}
            {!launch.themeLive && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={replaceOld} onChange={(e) => setReplaceOld(e.target.checked)} />
                <span>
                  Replace this launch
                  <span className="block text-xs text-muted-foreground">
                    When the new one is ready, this launch{isStore ? " and its theme are" : " is"} removed. The Shopify product is updated, not copied.
                  </span>
                </span>
              </label>
            )}
            <Button
              className="w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await relaunch({ launchId: launch._id, aiPhotos, reviewsUrl: reviewsUrl.trim(), replaceOld });
                  setStarted(r.launchId);
                } catch (err) {
                  toast.error(errorMessage(err, "Couldn't relaunch"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
              Relaunch
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
