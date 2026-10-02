import { useRef, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useNavigate } from "react-router-dom";
import { Camera, ImageUp, Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import ProductCard from "./ProductCard.tsx";
import AdCard from "../ad-spy/_components/AdCard.tsx";

// Search by image: the photo is shrunk in the browser, Claude says what the
// product is (convex/imageSearch.ts) and we show matching products and ads.

type Result = FunctionReturnType<typeof api.imageSearch.search>;

// Longest side ≤ 1024 px, JPEG: keeps uploads small and the AI call cheap.
async function shrink(file: File): Promise<{ data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image"));
      i.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL("image/jpeg", 0.85);
    return { data: preview.split(",")[1], preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ImageSearchDialog({ trigger = "button" }: { trigger?: "button" | "icon" }) {
  const search = useAction(api.imageSearch.search);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (JPG, PNG or WebP).");
      return;
    }
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { data, preview } = await shrink(file);
      setPreview(preview);
      setResult(await search({ imageBase64: data, mediaType: "image/jpeg" }));
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof (e.data as { message?: unknown })?.message === "string"
          ? (e.data as { message: string }).message
          : e instanceof Error
            ? e.message
            : "Image search failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {trigger === "icon" ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} title="Search by image" className="h-8 px-2.5">
          <Camera className="w-4 h-4" />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Camera className="w-4 h-4 mr-1.5" />
          Search by image
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Search by image</DialogTitle>
            <DialogDescription>Upload a product photo or screenshot. AI recognises the product and finds matching products and ads.</DialogDescription>
          </DialogHeader>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void run(e.dataTransfer.files[0]);
            }}
            onPaste={(e) => void run([...e.clipboardData.files][0])}
            className="flex flex-col sm:flex-row items-center gap-4 border border-dashed border-border rounded-xl p-4"
          >
            {preview ? (
              <img src={preview} alt="Your photo" className="w-28 h-28 rounded-lg object-cover border border-border" />
            ) : (
              <div className="w-28 h-28 rounded-lg bg-muted flex items-center justify-center">
                <ImageUp className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 text-center sm:text-left">
              <p className="text-sm mb-2">Drop an image here, paste a screenshot, or</p>
              <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void run(e.target.files?.[0])} />
              <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
                {busy ? <Spinner /> : <ImageUp className="w-4 h-4 mr-1.5" />}
                {busy ? "Looking…" : "Choose image"}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">Counts as 1 AI request.</p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && !result.identified && <p className="text-sm text-muted-foreground">No product found in that image. Try a clearer photo of the product.</p>}

          {result?.identified && (
            <div className="space-y-5">
              <div className="text-sm">
                Looks like <strong>{result.identified.productName}</strong>
                <span className="text-muted-foreground"> · {result.identified.niche}</span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {result.identified.searchTerms.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(`/dashboard/products?search=${encodeURIComponent(t)}`);
                      }}
                      className="text-xs px-2.5 h-7 rounded-full border border-border bg-muted/50 hover:border-primary/40 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Search className="w-3 h-3" />
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <section>
                <h3 className="text-sm font-semibold mb-2">Matching products ({result.products.length})</h3>
                {result.products.length ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3" onClick={() => setOpen(false)}>
                    {result.products.map((p) => (
                      <ProductCard key={p._id} product={p} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No matching products in AdSpy Pro yet.</p>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Ads selling it ({result.ads.length})</h3>
                {result.ads.length ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {result.ads.map((a) => (
                      <AdCard
                        key={a._id}
                        ad={a}
                        onClick={() => {
                          setOpen(false);
                          navigate(`/dashboard/ads/${a._id}`);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No matching ads yet.</p>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
