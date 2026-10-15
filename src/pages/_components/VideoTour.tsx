import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils.ts";

// Screen recordings of the live app (public/videos, made in ~/Videos/adspy-live).
// Click to play: nothing downloads until the visitor asks for it.
const TOURS = [
  {
    id: "launch",
    label: "Product to store",
    length: "1:33",
    summary: "Find a winner, check its numbers, then build a Shopify store for it.",
  },
  {
    id: "adspy",
    label: "Ad Spy",
    length: "1:12",
    summary: "Ads that are still scaling, proven offers, and what's inside one ad.",
  },
  {
    id: "research",
    label: "Product research",
    length: "1:21",
    summary: "What's rising this week, how a category is doing, and where to source it.",
  },
  {
    id: "stores",
    label: "Stores",
    length: "1:04",
    summary: "Find stores that are winning, see their daily sales and how they're built.",
  },
] as const;

export default function VideoTour() {
  const [active, setActive] = useState<(typeof TOURS)[number]["id"]>("launch");
  const [started, setStarted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const tour = TOURS.find((t) => t.id === active) ?? TOURS[0];

  const pick = (id: typeof active) => {
    // Once one tour has played, picking another starts it straight away (autoPlay below).
    setActive(id);
  };

  return (
    <section id="tour" className="py-24 scroll-mt-16" aria-labelledby="tour-heading">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-10">
          <h2 id="tour-heading" className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-balance">
            Watch it work in the live app
          </h2>
          <p className="text-muted-foreground text-lg">
            No mockups. Each tour is recorded in AdSpy Pro on a normal day, with the products and numbers it showed that morning.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <div className="relative aspect-video rounded-2xl overflow-hidden border border-border bg-card shadow-2xl shadow-black/30">
            <video
              key={tour.id}
              ref={video}
              className="w-full h-full object-cover"
              src={`/videos/tour-${tour.id}.mp4`}
              poster={`/videos/tour-${tour.id}.webp`}
              preload="none"
              playsInline
              autoPlay={started}
              controls={started}
              aria-label={`${tour.label} tour, ${tour.length}`}
            />
            {!started && (
              <button
                type="button"
                onClick={() => {
                  setStarted(true);
                  void video.current?.play().catch(() => {});
                }}
                className="group absolute inset-0 flex items-end justify-start p-4 sm:p-6 bg-gradient-to-t from-black/60 via-black/0 to-black/0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              >
                <span className="flex items-center gap-3 rounded-full bg-primary text-primary-foreground pl-4 pr-5 h-12 sm:h-14 text-sm sm:text-base font-semibold shadow-lg transition-transform group-hover:scale-105 group-active:scale-95">
                  <Play className="w-5 h-5 fill-current" aria-hidden="true" />
                  Play the {tour.length} tour
                </span>
              </button>
            )}
          </div>

          <div role="tablist" aria-label="Choose a tour" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {TOURS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === active}
                onClick={() => pick(t.id)}
                className={cn(
                  "text-left rounded-xl border px-4 py-3 min-h-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  t.id === active ? "border-primary/60 bg-primary/10" : "border-border bg-card/60 hover:border-foreground/25",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-sm">{t.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.length}</span>
                </span>
                <span className="hidden sm:block text-xs text-muted-foreground mt-1 leading-relaxed">{t.summary}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
