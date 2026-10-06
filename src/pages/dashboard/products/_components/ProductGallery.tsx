import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { cn } from "@/lib/utils.ts";

// Product photos: the main image, more photos from the store page
// (convex/productImages.ts, fetched the first time the product is opened)
// and the covers of the ads selling it. Broken images are dropped.

type Photo = { src: string; label?: string };

export default function ProductGallery({ product }: { product: Doc<"products"> }) {
  const loadImages = useAction(api.productImages.load);
  const ads = useQuery(api.history.productAds, product.linkedAds ? { productId: product._id } : "skip");
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!product.imagesCheckedAt) void loadImages({ productId: product._id }).catch(() => {});
  }, [product._id, product.imagesCheckedAt, loadImages]);

  const seen = new Set<string>();
  const photos: Photo[] = [
    { src: product.imageUrl },
    ...(product.images ?? []).map((src) => ({ src })),
    ...(ads ?? []).filter((a) => a.creativeUrl).slice(0, 8).map((a) => ({ src: a.creativeUrl, label: `Ad · ${a.platform}` })),
  ].filter((p) => p.src && !broken.has(p.src) && !seen.has(p.src) && seen.add(p.src));

  const current = photos[Math.min(index, photos.length - 1)];
  const go = (d: number) => setIndex((i) => (i + d + photos.length) % photos.length);
  const drop = (src: string) => setBroken((b) => new Set(b).add(src));

  if (!current) return <div className="rounded-xl border border-border bg-muted aspect-[4/3] mb-4" />;

  return (
    <div className="mb-4">
      <div className="relative rounded-xl overflow-hidden border border-border bg-muted group">
        <img src={current.src} alt={product.title} onError={() => drop(current.src)} className="w-full aspect-[4/3] object-contain bg-white" />
        {current.label && (
          <span className="absolute top-2 left-2 text-[11px] font-medium bg-black/65 text-white rounded-md px-2 py-0.5">{current.label}</span>
        )}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="absolute bottom-2 right-2 text-[11px] bg-black/65 text-white rounded-md px-2 py-0.5 tabular-nums">
              {Math.min(index, photos.length - 1) + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={p.src}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                "shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 bg-muted cursor-pointer",
                i === Math.min(index, photos.length - 1) ? "border-primary" : "border-transparent opacity-80 hover:opacity-100",
              )}
              title={p.label}
            >
              <img src={p.src} alt="" loading="lazy" onError={() => drop(p.src)} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
