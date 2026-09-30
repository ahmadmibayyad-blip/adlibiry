import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ChevronRight, Play } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { compactNumber, flag } from "@/lib/adFormat.ts";
import { ChartCard, RangeSwitch, SplitBars, StatTile, TimeChart } from "../../_components/charts.tsx";
import { dailyChange, money, pct, type Point, type Range } from "../../_components/chartUtils.ts";

type Product = Doc<"products">;

const WINNER_LINE = 65;

// Badges + stat tiles shown under the product title.
export function ProductHeadline({ product }: { product: Product }) {
  const ads = useQuery(api.history.productAds, product.linkedAds ? { productId: product._id } : "skip");
  const platforms = [...new Set((ads ?? []).map((a) => a.platform))];
  const countries = [...new Set((ads ?? []).map((a) => a.country).filter((c) => c && c !== "INTL"))];
  const adsRunning = product.linkedAds || product.adsCount;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {product.winnerRank !== undefined && (
          <>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/15 text-primary">Winner</span>
            <Link to="/dashboard/winners" className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:underline">
              #{product.winnerRank} in {product.category}
            </Link>
          </>
        )}
        {(product.linkedAds ?? 0) > 0 && (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-400">
            Detected from {product.linkedAds} ad{product.linkedAds === 1 ? "" : "s"}
            {platforms.length > 0 && ` · ${platforms.join(", ")}`}
            {countries.length > 0 && ` · ${countries.slice(0, 3).join(", ")}${countries.length > 3 ? "…" : ""}`}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Score" value={`${product.aiScore}`} />
        <StatTile label="Est. GMV" value={product.linkedGmv ? money(product.linkedGmv) : "—"} hint="Estimated sales, from TikTok Shop data where available" />
        <StatTile label="Views" value={product.linkedViews ? compactNumber(product.linkedViews) : "—"} />
        <StatTile label="Likes" value={product.likes ? compactNumber(product.likes) : "—"} />
        <StatTile label="Ads running" value={adsRunning ? `${adsRunning}` : "—"} />
        <StatTile label="Ad spend (est.)" value={product.linkedSpend ? `≤${money(product.linkedSpend)}` : "—"} hint="Upper end of the estimated spend of all linked ads" />
      </div>
    </div>
  );
}

export default function ProductPerformance({ product }: { product: Product }) {
  const [range, setRange] = useState<Range>(30);
  const history = useQuery(api.history.productHistory, { productId: product._id, days: range });
  const ads = useQuery(api.history.productAds, { productId: product._id });

  const rows = history ?? [];
  const enough = rows.length >= 2;
  const series = (get: (r: (typeof rows)[number]) => number): Point[] => rows.map((r) => ({ day: r.day, value: get(r) }));
  const views = series((r) => r.views);
  const spendPerDay = dailyChange(series((r) => r.spend));
  const score = series((r) => r.score);
  const engagement = series((r) => (r.views > 0 ? (r.likes + r.comments) / r.views : 0));
  const viewsGained = views.length >= 2 ? views[views.length - 1].value - views[0].value : 0;
  const crossed = score.find((p, i) => i > 0 && p.value >= WINNER_LINE && score[i - 1].value < WINNER_LINE);

  const adList = ads ?? [];
  // Views, spend and engagement only exist for products with linked ads.
  const hasAdData = (product.linkedAds ?? 0) > 0 || adList.length > 0;
  const firstDay = rows[0]?.day;
  const countBy = (keyOf: (a: (typeof adList)[number]) => string) => {
    const m = new Map<string, number>();
    for (const a of adList) m.set(keyOf(a), (m.get(keyOf(a)) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const longest = Math.max(1, ...adList.map((a) => a.daysRunning));

  return (
    <section className="mt-10 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Performance</h2>
        <RangeSwitch value={range} onChange={setRange} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {hasAdData && (
          <>
            <ChartCard title="Views over time" points={views} enough={enough} firstDay={firstDay} headline={<span className="tabular-nums">+{compactNumber(viewsGained)} in {range}d</span>}>
              <TimeChart kind="area" points={views} label="views" />
            </ChartCard>
            <ChartCard title="Estimated daily ad spend" points={spendPerDay} format={money} enough={enough} firstDay={firstDay}>
              <TimeChart kind="bar" points={spendPerDay} label="spend" format={money} />
            </ChartCard>
          </>
        )}
        <ChartCard
          title="Score history"
          points={score}
          format={(n) => `${Math.round(n)}`}
          enough={enough}
          firstDay={firstDay}
          headline={crossed ? <span>Became a winner on {new Date(`${crossed.day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}</span> : undefined}
        >
          <TimeChart kind="line" points={score} label="score" format={(n) => `${Math.round(n)}`} domain={[0, 100]} reference={{ y: WINNER_LINE, label: `Winner line ${WINNER_LINE}` }} />
        </ChartCard>
        {hasAdData ? (
          <ChartCard
            title="Engagement rate (likes + comments ÷ views)"
            points={engagement}
            format={pct}
            enough={enough}
            firstDay={firstDay}
            headline={engagement.length ? <span className="tabular-nums">{pct(engagement[engagement.length - 1].value)}</span> : undefined}
          >
            <TimeChart kind="line" points={engagement} label="engagement" format={pct} />
          </ChartCard>
        ) : (
          <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center">
            <h3 className="text-sm font-semibold mb-1">No ads linked to this product yet</h3>
            <p className="text-xs text-muted-foreground">
              Views, ad spend and engagement come from running ads for this product. When an ad in Ad Spy links to this
              product's page, it's attached automatically and these charts appear.
            </p>
          </div>
        )}
      </div>

      {adList.length > 0 && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <h3 className="text-sm font-semibold">Where the ads run</h3>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Platform</div>
                <SplitBars items={countBy((a) => a.platform)} total={adList.length} empty="No ads yet." />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Country</div>
                <SplitBars
                  items={countBy((a) => (a.country && a.country !== "INTL" ? `${flag(a.country)} ${a.country}` : "Several / unknown"))}
                  total={adList.length}
                  empty="No ads yet."
                />
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-3">Ad timeline</h3>
              <div className="space-y-2">
                {adList.slice(0, 10).map((a, i) => (
                  <div key={a._id} className="grid grid-cols-[3rem_minmax(0,1fr)_4rem] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Ad {i + 1}</span>
                    {/* Bars end at "today" and reach back as far as each ad has run. */}
                    <div className="h-3 flex justify-end">
                      <div
                        className="h-full rounded-l-sm rounded-r"
                        style={{ width: `${Math.max(2, (a.daysRunning / longest) * 100)}%`, background: "var(--chart-2)", opacity: i === 0 ? 1 : 0.7 }}
                        title={`${a.headline} — ${a.daysRunning} days`}
                      />
                    </div>
                    <span className="tabular-nums">{a.daysRunning} days</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Each bar ends today. A second ad starting later usually means the seller is scaling.
              </p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Ads for this product</h3>
              <span className="text-xs text-muted-foreground">
                {adList.length} ad{adList.length === 1 ? "" : "s"} merged into this product
              </span>
            </div>
            <div className="divide-y divide-border">
              {adList.map((a) => (
                <Link key={a._id} to={`/dashboard/ads/${a._id}`} className="flex items-center gap-3 py-3 hover:bg-muted/40 -mx-2 px-2 rounded-lg">
                  <div className="relative w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
                    {a.creativeUrl && <img src={a.creativeUrl} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    {a.mediaType === "video" && <Play className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">“{a.headline}”</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.advertiserName} · {a.platform} · {a.country} · {a.daysRunning} days
                    </div>
                  </div>
                  <div className="hidden sm:grid grid-cols-3 gap-6 text-xs text-right">
                    <div><div className="text-muted-foreground">Views</div><div className="font-semibold tabular-nums">{compactNumber(a.views)}</div></div>
                    <div><div className="text-muted-foreground">Likes</div><div className="font-semibold tabular-nums">{compactNumber(a.likes)}</div></div>
                    <div><div className="text-muted-foreground">GMV</div><div className="font-semibold tabular-nums">{a.gmv ? money(a.gmv) : "—"}</div></div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
