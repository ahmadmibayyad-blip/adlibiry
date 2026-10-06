import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils.ts";

// A product photo that never shows as a broken image or an empty dark box:
// a soft pulse while it loads, and a labelled placeholder when there's no
// image or it fails to load (expired CDN links are common in ad data).
export default function ProductImage({ src, alt, className, loading = "lazy" }: { src?: string; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">(src ? "loading" : "failed");
  if (state === "failed") {
    return (
      <div role="img" aria-label={alt || "No image"} className={cn("flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-muted to-secondary text-muted-foreground", className)}>
        <ImageOff className="w-5 h-5 opacity-60" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onLoad={() => setState("ok")}
      onError={() => setState("failed")}
      className={cn(className, state === "loading" && "animate-pulse bg-muted")}
    />
  );
}
