import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { ChartCard, TimeChart, StatTile } from "../../_components/charts.tsx";
import { money } from "../../_components/chartUtils.ts";

// Sales tracking in the store popup (convex/storeSales.ts): estimates from the
// store's public catalog, saved once a day.

const ago = (iso: string) => {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
};
const range = (low: number, high: number, fmt: (n: number) => string) => (high ? `${fmt(low)}–${fmt(high)}` : "0");

export default function StoreSales({ storeId }: { storeId: Id<"stores"> }) {
  const data = useQuery(api.storeSales.history, { storeId });
  const checkNow = useAction(api.storeSales.checkNow);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const r = await checkNow({ storeId });
      if (r.status === "ok") toast.success(r.updatedCount ? `${r.updatedCount} products changed recently` : "Checked. No products changed in the last day.");
      else if (r.status === "recent") toast.info("Checked less than an hour ago.");
      else toast.error(r.error);
    } catch (e) {
      toast.error(e instanceof ConvexError ? (e.data as { message: string }).message : "Couldn't check the store");
    } finally {
      setChecking(false);
    }
  };

  if (data === undefined) return <Spinner />;
  if (!data) return null;
  const { check: last, days } = data;
  const latest = days.at(-1);
  // Per-24h revenue midpoint for the chart.
  const points = days.map((d) => ({ day: d.day, value: ((d.estRevenueLow + d.estRevenueHigh) / 2) * (24 / Math.max(1, d.windowHours)) }));
  const total = days.slice(-30).reduce((a, d) => ({ low: a.low + d.estRevenueLow, high: a.high + d.estRevenueHigh }), { low: 0, high: 0 });

  return (
    <section className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5 whitespace-nowrap">
          <Activity className="w-4 h-4 text-primary" />
          Sales tracking
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {last && <span className="hidden sm:inline whitespace-nowrap">Checked {ago(last.at)}</span>}
          <Button size="sm" variant="outline" onClick={check} disabled={checking} className="h-7 px-2.5">
            {checking ? <Spinner /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Check now
          </Button>
        </div>
      </div>

      {last && !last.ok && !latest && (
        <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
          We couldn't read this store's catalog ({last.error}). Sales tracking works for Shopify stores with a public catalog.
        </p>
      )}

      {!last && !latest && (
        <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
          Not tracked yet. Track the store or click Check now. We then check it once a day and build a sales history.
        </p>
      )}

      {latest && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatTile label="Est. orders, last day" value={range(latest.estOrdersLow, latest.estOrdersHigh, String)} hint={`${latest.updatedCount} of ${latest.productCount} products changed`} />
            <StatTile label="Est. revenue, last day" value={range(latest.estRevenueLow, latest.estRevenueHigh, money)} hint={latest.newCount ? `${latest.newCount} new products` : undefined} />
            <StatTile label={`Est. revenue, ${Math.min(days.length, 30)} days tracked`} value={range(total.low, total.high, money)} />
          </div>

          <ChartCard title="Est. revenue per day" points={points} format={money} enough={points.length >= 2} firstDay={days[0]?.day} time="10:05 UTC">
            <TimeChart kind="bar" points={points} label="est. revenue" format={money} />
          </ChartCard>

          {latest.topProducts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Recently selling</h4>
              <div className="space-y-2">
                {latest.topProducts.map((p) => (
                  <a
                    key={p.url + p.title}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-muted rounded-lg p-2 hover:bg-muted/70"
                  >
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="w-10 h-10 rounded-md object-cover shrink-0"
                        loading="lazy"
                        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-background shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium line-clamp-1">{p.title}</div>
                      <div className="text-xs text-muted-foreground">Changed {ago(p.updatedAt)}</div>
                    </div>
                    {p.price > 0 && <div className="text-sm font-bold shrink-0">${p.price.toFixed(2)}</div>}
                  </a>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            How we estimate: Shopify updates a product when its stock changes, so each product that changed since the last check counts as
            1–3 orders at its price. Edits by the store owner also count, so treat these as ranges.
          </p>
        </div>
      )}
    </section>
  );
}
