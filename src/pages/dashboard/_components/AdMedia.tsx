import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { tiktokEmbedUrl, tiktokVideoId } from "@/lib/adVideo.ts";
import { cn } from "@/lib/utils.ts";

// The ad's creative on the ad page and in the Ad Spy popup: the video file,
// TikTok's embed player, or the image.
export default function AdMedia({ ad, maxHeight = "70vh" }: { ad: Doc<"ads">; maxHeight?: string }) {
  const tiktokId = ad.videoUrl ? null : tiktokVideoId(ad);
  if (ad.videoUrl) {
    return <video src={ad.videoUrl} poster={ad.creativeUrl || undefined} controls playsInline className="w-full bg-black" style={{ maxHeight }} />;
  }
  if (tiktokId) {
    return (
      <div className="bg-black">
        <iframe
          src={tiktokEmbedUrl(tiktokId)}
          title={ad.headline}
          allow="encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full aspect-[9/16] mx-auto block"
          style={{ maxHeight }}
        />
        {ad.adLibraryUrl && (
          <a href={ad.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-[11px] text-white/70 hover:text-white py-1.5">
            Not playing? Watch on TikTok
          </a>
        )}
      </div>
    );
  }
  if (ad.creativeUrl) {
    return <img src={ad.creativeUrl} alt={ad.headline} className={cn("w-full object-contain bg-black")} style={{ maxHeight }} />;
  }
  return <div className="aspect-square flex items-center justify-center text-sm text-muted-foreground">No creative</div>;
}
