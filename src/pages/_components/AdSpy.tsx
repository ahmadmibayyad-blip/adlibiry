import { useQuery } from "convex/react";
import { Eye, DollarSign, CalendarDays } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { compactNumber, spendLabel } from "@/lib/adFormat.ts";
import { parseCompact } from "@/convex/lib/productMatch.ts";
import { cn } from "@/lib/utils.ts";

function Metric({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="w-3 h-3" aria-hidden="true" />
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// Three real running ads from the database, one per advertiser and niche.
export default function AdSpy() {
  const stats = useQuery(api.stats.get, {});
  // Public preview: three real running ads (see ads:homepagePreview).
  const list = useQuery(api.ads.homepagePreview, {});
  const ads = list ?? [];

  return (
    <section className="py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-12">
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">Look inside any ad</h2>
          <p className="text-muted-foreground text-lg">
            Every ad comes with its creative, estimated spend, reach and how long it has been running. These three are
            live in the app right now.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          {list === undefined
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="aspect-[4/3] bg-muted animate-pulse" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                    <div className="h-12 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))
            : ads.map((ad) => {
                const views = ad.impressions ?? parseCompact(ad.views);
                return (
                  <article key={ad._id} className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="relative aspect-[4/3] bg-muted">
                      <img src={ad.creativeUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      <div
                        className={cn(
                          "absolute top-3 left-3 flex items-baseline gap-1 rounded-lg px-2 py-1",
                          ad.aiScore >= 85 ? "bg-good text-white dark:text-background" : "bg-foreground text-background",
                        )}
                      >
                        <span className="text-[10px] opacity-80">Ad score</span>
                        <span className="text-sm font-bold tabular-nums">{ad.aiScore}</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-sm truncate">{ad.advertiserName}</h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        {ad.niche} on {ad.platform}
                        {ad.country ? `, ${ad.country}` : ""}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <Metric icon={DollarSign} label="Spend" value={spendLabel(ad.spendEstimate) ?? "—"} />
                        <Metric icon={Eye} label="Views" value={views ? compactNumber(views) : "—"} />
                        <Metric icon={CalendarDays} label="Running" value={ad.daysRunning > 0 ? `${ad.daysRunning} days` : "—"} />
                      </div>
                    </div>
                  </article>
                );
              })}
        </div>

        <p className="text-sm text-muted-foreground">
          3 of {stats ? stats.ads.total.toLocaleString("en-US") : "…"} ads. Start your free trial to search them all.
        </p>
      </div>
    </section>
  );
}
