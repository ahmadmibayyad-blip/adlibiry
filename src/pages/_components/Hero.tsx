import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import HideOnError from "@/components/HideOnError.tsx";

const fmt = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString("en-US"));

// The hero shows the product itself: today's top-scoring winners, read live
// from the same list the dashboard's Winning Products page uses.
function TodaysWinners() {
  // Public preview: five winners, one per niche (see winners:homepagePreview).
  const rows = useQuery(api.winners.homepagePreview, {});
  const summary = useQuery(api.winners.summary, {});

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3 border-b border-border">
        <h2 className="font-display text-lg font-bold">Current winners</h2>
        <span className="text-xs text-muted-foreground">New mix every 3 days</span>
      </div>
      <ul aria-busy={rows === undefined}>
        {rows === undefined
          ? Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
                <div className="w-12 h-12 rounded-lg bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="h-2.5 w-1/3 rounded bg-muted animate-pulse" />
                </div>
              </li>
            ))
          : rows.map((product) => (
              <li key={product._id} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
                <img src={product.imageUrl} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-cover bg-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{product.title}</div>
                  <div className="text-xs text-muted-foreground">
                    #{product.nicheRank} in {product.niche}
                  </div>
                </div>
                <div
                  className={cn(
                    "flex items-baseline gap-1 rounded-lg px-2 py-1 shrink-0",
                    product.aiScore >= 85 ? "bg-good text-white dark:text-background" : "bg-foreground text-background",
                  )}
                >
                  <span className="text-[10px] opacity-80">Score</span>
                  <span className="text-sm font-bold tabular-nums">{product.aiScore}</span>
                </div>
              </li>
            ))}
      </ul>
      <div className="px-5 py-3 bg-muted/50 text-xs text-muted-foreground">
        {summary ? `${fmt(summary.total)} winners across ${summary.perNiche.length} niches in the app.` : " "}
      </div>
    </div>
  );
}

export default function Hero() {
  const stats = useQuery(api.stats.get, {});

  return (
    <section className="pt-28 pb-20 lg:pt-36 lg:pb-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.02] text-balance mb-6">
            Find the products that are already selling.
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mb-8">
            AdSpy Pro watches {fmt(stats?.ads.total)} ads on Facebook, Instagram and TikTok, ties them to the{" "}
            {fmt(stats?.products.total)} products they sell, and scores every one. The strongest rise to the top of
            your list each morning.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button asChild size="lg" className="h-12 px-6 text-base font-semibold rounded-xl">
              <a href="/#pricing">
                Start free
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </a>
            </Button>
            <a href="/#features" className="text-sm font-medium text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground">
              See what's inside
            </a>
          </div>
        </div>
        <HideOnError>
          <TodaysWinners />
        </HideOnError>
      </div>
    </section>
  );
}
