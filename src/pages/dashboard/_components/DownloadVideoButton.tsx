import { useState } from "react";
import { Authenticated, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Download, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { tiktokVideoId } from "@/lib/adVideo.ts";
import { Spinner } from "@/components/ui/spinner.tsx";

// Saves an ad's video as a file (convex/videoDownload.ts). Signed-in users only.
function DownloadButton({ adId, className, label = "Download video" }: { adId: Id<"ads">; className?: string; label?: string }) {
  const getUrl = useAction(api.videoDownload.downloadUrl);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          window.location.href = await getUrl({ adId });
        } catch (e) {
          toast.error(e instanceof ConvexError ? (e.data as { message: string }).message : "Couldn't download the video");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <Download className="w-4 h-4 mr-1.5" />}
      {label}
    </Button>
  );
}

export default function DownloadVideoButton(props: { adId: Id<"ads">; className?: string; label?: string }) {
  return (
    <Authenticated>
      <DownloadButton {...props} />
    </Authenticated>
  );
}

// For ads with a stored video file: Download. For video ads whose source gave
// no file (e.g. TikTok via Nexscope): a link to watch it at the source.
export function AdVideoAction({ ad, className, label }: { ad: Doc<"ads">; className?: string; label?: string }) {
  if (ad.videoUrl || tiktokVideoId(ad)) return <DownloadVideoButton adId={ad._id} className={className} label={label} />;
  // TikTok embeds have their own "Watch on TikTok" link under the player.
  const watch = ad.mediaType === "video" && !tiktokVideoId(ad) ? ad.adLibraryUrl : undefined;
  if (!watch) return null;
  return (
    <Button asChild variant="outline" className={className} title="The source didn't give us the video file, so it can't be downloaded here.">
      <a href={watch} target="_blank" rel="noopener noreferrer">
        <PlayCircle className="w-4 h-4 mr-1.5" />
        Watch video
      </a>
    </Button>
  );
}
