import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils.ts";

// 20-second reels recorded in the live app (public/videos). They play muted while on screen;
// tapping one plays it from the start with sound and mutes the rest.
const REELS = [
  { id: "find", tool: "Winning products", title: "Find a winner in under a minute" },
  { id: "analyse", tool: "Should I test this?", title: "Check the numbers before you spend" },
  { id: "store", tool: "Launch", title: "Build the Shopify store for it" },
  { id: "scaling", tool: "Ad Spy", title: "Ads that are still scaling" },
  { id: "rising", tool: "Product research", title: "Spot what's rising this week" },
  { id: "sales", tool: "Stores", title: "See a store's daily sales" },
] as const;

type ReelId = (typeof REELS)[number]["id"];

function Reel({ reel, withSound, onSound }: { reel: (typeof REELS)[number]; withSound: boolean; onSound: (on: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // Play while mostly on screen, pause when it scrolls away. Reduced motion: only on tap.
  useEffect(() => {
    const el = video.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = video.current;
    if (el) el.muted = !withSound;
  }, [withSound]);

  const tap = () => {
    const el = video.current;
    if (!el) return;
    if (withSound) {
      onSound(false);
      return;
    }
    el.currentTime = 0;
    el.muted = false;
    onSound(true);
    void el.play().catch(() => {});
  };

  return (
    <li className="snap-start shrink-0 w-[15rem] sm:w-[16rem]">
      <button
        type="button"
        onClick={tap}
        aria-pressed={withSound}
        aria-label={withSound ? `Mute "${reel.title}"` : `Play "${reel.title}" with sound`}
        className="group relative block w-full aspect-[9/16] rounded-2xl overflow-hidden border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <video
          ref={video}
          className="w-full h-full object-cover"
          src={`/videos/reel-${reel.id}.mp4`}
          poster={`/videos/reel-${reel.id}.webp`}
          preload="none"
          muted
          loop
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-hidden="true"
        />
        {!playing && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex w-14 h-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
              <Play className="w-6 h-6 fill-current translate-x-0.5" aria-hidden="true" />
            </span>
          </span>
        )}
        <span
          className={cn(
            "absolute top-3 right-3 flex w-9 h-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors",
            withSound ? "bg-primary text-primary-foreground" : "bg-black/55 text-white",
          )}
        >
          {withSound ? <Volume2 className="w-4 h-4" aria-hidden="true" /> : <VolumeX className="w-4 h-4" aria-hidden="true" />}
        </span>
      </button>
      <p className="mt-3 text-xs font-medium text-primary">{reel.tool}</p>
      <p className="text-sm font-semibold leading-snug">{reel.title}</p>
    </li>
  );
}

export default function Reels() {
  const [sound, setSound] = useState<ReelId | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const scroll = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * 272 * 2, behavior: "smooth" });

  return (
    <section className="py-24 bg-card/30 border-y border-border overflow-hidden" aria-labelledby="reels-heading">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-6 mb-10">
          <div className="max-w-2xl">
            <h2 id="reels-heading" className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-balance">
              One tool, 20 seconds
            </h2>
            <p className="text-muted-foreground text-lg">Short clips of each tool on a phone. Tap one to hear it.</p>
          </div>
          <div className="hidden md:flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => scroll(-1)}
              aria-label="Previous clips"
              className="w-11 h-11 rounded-full border border-border bg-card flex items-center justify-center hover:border-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scroll(1)}
              aria-label="Next clips"
              className="w-11 h-11 rounded-full border border-border bg-card flex items-center justify-center hover:border-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul
          ref={strip}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {REELS.map((reel) => (
            <Reel key={reel.id} reel={reel} withSound={sound === reel.id} onSound={(on) => setSound(on ? reel.id : null)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
