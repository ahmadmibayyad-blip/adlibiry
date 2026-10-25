import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { ImageUp, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { DesignWishes } from "@/convex/lib/designWishes.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import LinkScreenshot from "@/components/LinkScreenshot.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { pastedImage, screenshotParts } from "@/lib/screenshotParts.ts";

// Launch → Full store → "Match a screenshot": a screenshot of a store the owner likes; the AI reads its colors,
// fonts and shapes (convex/screenshotLook.ts) and the store is built with them over the picked style.

const ROUNDNESS = { square: "Sharp corners", soft: "Slightly rounded", round: "Round" } as const;

export default function ScreenshotLook({ value, onChange, dawn }: { value: DesignWishes | null; onChange: (look: DesignWishes | null) => void; dawn: boolean }) {
  const read = useAction(api.screenshotLook.read);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const use = async (file: Blob | null | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      // The top of a store shows its look; two parts are plenty.
      const { parts, preview } = await screenshotParts(file, { maxParts: 2 });
      setPreview(preview);
      const r = await read({ images: parts });
      onChange(r.look);
      if (!r.look) setError(r.message ?? "We couldn't read a look from that screenshot.");
    } catch (e) {
      onChange(null);
      setError(errorMessage(e, "We couldn't read that screenshot. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const colors = value ? ([["Buttons", value.accent], ["Background", value.background], ["Soft background", value.surface], ["Text", value.text]] as const).filter(([, c]) => c) : [];

  return (
    <div className="block text-sm" onPaste={(e) => void use(pastedImage(e))}>
      <span className="font-medium flex items-center gap-1.5">
        <ImageUp className="w-4 h-4 text-primary" /> Match a screenshot <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void use(e.target.files?.[0])} />
      {value || busy ? (
        <div className="mt-1 flex gap-3 rounded-lg border border-border p-3">
          {preview ? <img width={80} height={80} src={preview} alt="Your screenshot" className="w-20 h-20 rounded-md object-cover object-top border border-border shrink-0" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            {busy ? (
              <p className="flex items-center gap-2 text-muted-foreground"><Spinner className="w-4 h-4" /> Reading the colors, fonts and shapes…</p>
            ) : value ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {colors.map(([label, c]) => (
                    <span key={label} className="flex items-center gap-1.5 text-xs">
                      <span className="w-4 h-4 rounded-full border border-border" style={{ background: c }} /> {label}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[
                    !dawn && (value.headingFont || value.bodyFont) ? `Fonts: ${[...new Set([value.headingFont, value.bodyFont].filter(Boolean))].join(" and ")}` : "",
                    value.roundness ? ROUNDNESS[value.roundness] : "",
                    value.uppercase ? "Uppercase headings" : "",
                    !dawn && value.heroLayout ? (value.heroLayout === "center" ? "Centered hero" : "Photo beside the hero text") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>Another screenshot</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(null); setPreview(null); }}>
                    <X className="w-4 h-4 mr-1" /> Remove
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-1 w-full rounded-lg border border-dashed border-border px-3 py-4 text-muted-foreground hover:text-foreground hover:border-primary transition text-sm"
        >
          Upload or paste a screenshot of a store you like
        </button>
      )}
      {!value && !busy ? <div className="mt-2"><LinkScreenshot onShot={use} /></div> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <span className="block mt-1 text-xs text-muted-foreground">
        {dawn
          ? "Your store takes its colors and shapes over the style you picked. Dawn keeps its own fonts."
          : "Your store takes its colors, fonts and shapes over the style you picked. Special requests still win."}{" "}
        Only the look: never its text, photos or logo.
      </span>
    </div>
  );
}
