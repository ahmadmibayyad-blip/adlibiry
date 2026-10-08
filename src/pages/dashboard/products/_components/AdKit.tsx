import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Check, Copy, Download, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { AD_HEIGHT, AD_WIDTH, drawAd } from "@/lib/adCanvas.ts";
import { errorMessage } from "@/lib/errorMessage.ts";

// A launch's ad kit (convex/launch.ts copy.adKit): the text of each ad, and an
// ad image per ad (convex/launchAds.ts). The picture comes from Google's image
// model; the hook and headline are drawn on it here, so they're spelled right,
// and the finished ad downloads as a JPEG.

type Ad = { angle: string; hook: string; primaryText: string; headline: string };
const MAX_RUNS = 3; // convex/launch.ts MAX_AD_IMAGE_RUNS

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground shrink-0"
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** The finished ad (picture + text) as a JPEG data URL, or null while it draws or if it can't. */
function useAdImage(src: string | undefined, ad: Ad): string | null | "error" {
  // Keyed by what was drawn, so a new picture or text shows the spinner until it's redrawn.
  const key = `${src}
${ad.hook}
${ad.headline}`;
  const [out, setOut] = useState<{ key: string; value: string | "error" } | null>(null);
  useEffect(() => {
    if (!src) return;
    let gone = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      await document.fonts?.load('700 60px "IBM Plex Sans"').catch(() => {});
      if (gone) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = AD_WIDTH;
        canvas.height = AD_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        drawAd(ctx, img, { hook: ad.hook, headline: ad.headline });
        setOut({ key, value: canvas.toDataURL("image/jpeg", 0.92) });
      } catch {
        setOut({ key, value: "error" });
      }
    };
    img.onerror = () => !gone && setOut({ key, value: "error" });
    img.src = src;
    return () => {
      gone = true;
    };
  }, [src, ad.hook, ad.headline, key]);
  return out?.key === key ? out.value : null;
}

function AdCard({ ad, index, src }: { ad: Ad; index: number; src?: string }) {
  const image = useAdImage(src, ad);
  return (
    <li className="rounded-lg border border-border p-2.5 text-xs flex gap-3 flex-col sm:flex-row">
      {src ? (
        <div className="sm:w-40 shrink-0 space-y-1.5">
          {image && image !== "error" ? (
            <>
              <img src={image} alt={`Ad ${index + 1}: ${ad.hook}`} className="w-full aspect-[4/5] rounded-md border border-border object-cover" />
              <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs">
                <a href={image} download={`ad-${index + 1}.jpg`}><Download className="w-3.5 h-3.5 mr-1" />Download</a>
              </Button>
            </>
          ) : image === "error" ? (
            <a href={src} target="_blank" rel="noopener noreferrer" className="block text-muted-foreground underline">Open the picture</a>
          ) : (
            <div className="w-full aspect-[4/5] rounded-md bg-muted grid place-items-center"><Spinner className="w-4 h-4" /></div>
          )}
        </div>
      ) : null}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-medium">{ad.angle}</div>
        {[["Hook", ad.hook], ["Primary text", ad.primaryText], ["Headline", ad.headline]].map(([label, text]) => (
          <div key={label} className="flex gap-2 items-start">
            <span className="text-muted-foreground w-20 shrink-0">{label}</span>
            <span className="flex-1">{text}</span>
            <CopyButton text={text} />
          </div>
        ))}
      </div>
    </li>
  );
}

/** The ad kit with its ad images, and the button that makes them. `ready`: the image model is set up. */
export default function AdKit({ l, ready }: { l: Doc<"launches">; ready: boolean }) {
  const make = useAction(api.launchAds.make);
  const [busy, setBusy] = useState(false);
  const ads = (l.copy as { adKit?: Ad[] } | undefined)?.adKit ?? [];
  if (!ads.length) return null;
  const images = l.adImages ?? [];
  const making = busy || l.adImagesStatus === "making";
  const runsLeft = MAX_RUNS - (l.adImageRuns ?? 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h4 className="text-sm font-semibold">Your ad kit</h4>
        {ready && l.status === "published" && runsLeft > 0 ? (
          <Button
            size="sm"
            variant={images.length ? "outline" : "default"}
            disabled={making}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await make({ launchId: l._id });
                if (r.note) toast.message(r.note);
              } catch (err) {
                toast.error(errorMessage(err, "Couldn't make the ad images"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {making ? <Spinner className="w-4 h-4 mr-1.5" /> : <ImagePlus className="w-4 h-4 mr-1.5" />}
            {making ? "Making ad images… (up to a minute)" : images.length ? "Make new ad images" : "Make ad images"}
          </Button>
        ) : null}
      </div>
      {l.adImagesNote && !making ? <p className="text-xs text-muted-foreground mb-2">{l.adImagesNote}</p> : null}
      <ul className="space-y-2">
        {ads.map((a, i) => (
          <AdCard key={i} ad={a} index={i} src={images.find((m) => m.ad === i)?.url} />
        ))}
      </ul>
      {images.length ? <p className="text-[11px] text-muted-foreground mt-1.5">Portrait 4:5 for Facebook and Instagram feeds. Paste the primary text next to it when you make the ad.</p> : null}
    </div>
  );
}
