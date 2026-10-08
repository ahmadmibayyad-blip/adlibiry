import { useEffect } from "react";
import { Check } from "lucide-react";
import { STORE_STYLE_FONTS_URL, STORE_STYLE_IDS, STORE_STYLES, type StoreStyleId } from "@/convex/lib/storeStyles.ts";
import { cn } from "@/lib/utils.ts";

// The looks a Full store launch can have (convex/lib/storeStyles.ts), each
// drawn as a small store front with the product's own photo.

function useStyleFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-store-style-fonts]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STORE_STYLE_FONTS_URL;
    link.dataset.storeStyleFonts = "";
    document.head.appendChild(link);
  }, []);
}

function Preview({ id, brand, imageUrl }: { id: StoreStyleId; brand: string; imageUrl?: string }) {
  const s = STORE_STYLES[id];
  const c = s.settings;
  const head = { fontFamily: `'${s.fonts.head}', sans-serif`, fontWeight: s.fonts.headWeight, textTransform: c.heading_uppercase ? "uppercase" : "none" } as const;
  const heroBg = s.schemes.hero === "accent" ? c.color_accent : s.schemes.hero === "surface" ? c.color_surface : c.color_bg;
  const heroText = s.schemes.hero === "accent" ? c.color_accent_text : c.color_text;
  const centered = s.heroLayout === "center";
  return (
    <div className="overflow-hidden text-left" style={{ background: c.color_bg, color: c.color_text, fontFamily: `'${s.fonts.body}', sans-serif` }} aria-hidden>
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ borderBottom: `1px solid ${c.color_text}1f` }}>
        <span className="truncate text-[10px] leading-none" style={head}>{brand}</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => <span key={i} className="block h-1 w-3 rounded-full" style={{ background: `${c.color_text}40` }} />)}
        </span>
      </div>
      <div className={cn("flex gap-2 p-2.5", centered && "flex-col items-center text-center")} style={{ background: heroBg, color: heroText }}>
        <div className={cn("flex-1 min-w-0 space-y-1.5", centered && "order-2")}>
          <div className="text-[13px] leading-[1.05]" style={head}>Made for every day</div>
          <div className="h-1 w-4/5 rounded-full opacity-40" style={{ background: heroText, marginInline: centered ? "auto" : undefined }} />
          <span
            className="inline-block px-2 py-0.5 text-[8px] font-semibold"
            style={{
              background: s.schemes.hero === "accent" ? c.color_accent_text : c.color_accent,
              color: s.schemes.hero === "accent" ? c.color_accent : c.color_accent_text,
              borderRadius: c.button_pill ? 999 : Math.min(c.radius, 8),
              textTransform: c.heading_uppercase ? "uppercase" : "none",
            }}
          >
            Shop now
          </span>
        </div>
        <div
          className={cn("shrink-0 overflow-hidden", centered ? "h-10 w-14" : "h-14 w-14")}
          style={{ borderRadius: Math.min(c.radius, 12), background: c.color_surface }}
        >
          {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-5" style={{ background: i === 1 ? c.color_accent : c.color_surface, borderRadius: Math.min(c.radius, 8) / 2, opacity: i === 1 ? 0.9 : 1 }} />
            <div className="h-0.5 w-3/4 rounded-full" style={{ background: `${c.color_text}33` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StylePicker({
  value,
  onChange,
  brand,
  imageUrl,
}: {
  value: StoreStyleId;
  onChange: (id: StoreStyleId) => void;
  brand: string;
  imageUrl?: string;
}) {
  useStyleFonts();
  return (
    <div role="radiogroup" aria-label="Store style" className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {STORE_STYLE_IDS.map((id) => {
        const s = STORE_STYLES[id];
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={cn(
              "group relative overflow-hidden rounded-lg border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
            )}
          >
            <Preview id={id} brand={brand || "Your store"} imageUrl={imageUrl} />
            <div className="border-t border-border bg-background px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="flex -space-x-1">
                  {[s.settings.color_bg, s.settings.color_text, s.settings.color_accent].map((col) => (
                    <span key={col} className="h-3 w-3 rounded-full border border-border" style={{ background: col }} />
                  ))}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.description}</p>
            </div>
            {selected && (
              <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
