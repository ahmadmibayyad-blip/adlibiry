import { useState } from "react";
import { Authenticated, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
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
