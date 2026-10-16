import { useState } from "react";
import { useAction } from "convex/react";
import { Camera } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// "Or paste a link": the server opens the page and takes a full-page screenshot (convex/pageShots.ts),
// handed over as an image like one the user uploaded.

export default function LinkScreenshot({ onShot, disabled }: { onShot: (image: Blob) => void | Promise<void>; disabled?: boolean }) {
  const take = useAction(api.pageShots.take);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!url.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const r = await take({ url: url.trim() });
      const blob = await fetch(`data:${r.mediaType};base64,${r.data}`).then((res) => res.blob());
      await onShot(blob);
      setUrl("");
    } catch (e) {
      setError(errorMessage(e, "We couldn't take a screenshot of that page."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          disabled={busy || disabled}
          placeholder="Or paste a link: https://store.com/products/…"
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={() => void run()} disabled={busy || disabled || !url.trim()}>
          {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Camera className="w-4 h-4 mr-2" />}
          {busy ? "Taking it…" : "Take screenshot"}
        </Button>
      </div>
      {busy ? <p className="text-xs text-muted-foreground">Opening the page and taking a full-page screenshot: about 20 seconds.</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
