import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ScanSearch, Store } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { shortDate } from "@/lib/adFormat.ts";
import { storeRevenueLabel } from "@/lib/estimateFormat.ts";
import { StatTile } from "./charts.tsx";

// In the store's own currency; the plain number when the currency is unknown.
function shopPrice(n: number, currency?: string): string {
  try {
    return currency ? new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n) : n.toFixed(2);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * The store this ad sends people to (convex/stores.ts forAd): revenue and traffic
 * when we track it, theme, apps, price and reviews from its last Store Inspector
 * check, and links to both. Nothing when the ad has no shop link.
 */
export default function AdStore({ adId, compact = false }: { adId: Id<"ads">; compact?: boolean }) {
  const data = useQuery(api.stores.forAd, { adId });
  if (!data) return null;
  const { store, inspection } = data;

  const revenue = store ? storeRevenueLabel(store) : undefined;
  const traffic = store && /\d/.test(store.trafficRange) ? store.trafficRange : undefined;
  const tiles = [
    revenue && { label: "Revenue (est.)", value: revenue, hint: store?.revenueConfidence ? `${store.revenueConfidence} confidence` : undefined },
    traffic && { label: "Traffic", value: traffic },
    data.adsTracked > 0 && { label: "Its ads we track", value: `${data.adsLive} live`, hint: `${data.adsLive} live of ${data.adsTracked} we've seen` },
    inspection?.theme && { label: "Theme", value: inspection.theme },
    inspection?.price && {
      label: inspection.price.percentOff ? `Price (${inspection.price.percentOff}% off)` : "Price",
      value: shopPrice(inspection.price.price, inspection.price.currency),
      hint: inspection.productTitle,
    },
    inspection?.reviews && {
      label: "Product reviews",
      value: [inspection.reviews.rating ? `★ ${inspection.reviews.rating.toFixed(1)}` : null, inspection.reviews.count ? `${inspection.reviews.count.toLocaleString()}` : null]
        .filter(Boolean)
        .join(" · "),
      hint: inspection.reviews.app ? `From ${inspection.reviews.app}` : undefined,
    },
    inspection?.onlineSince && { label: "Online since", value: new Date(inspection.onlineSince).getFullYear().toString() },
  ].filter((t): t is { label: string; value: string; hint?: string } => !!t);
  const shown = compact ? tiles.slice(0, 4) : tiles;

  const inspectLink = `/dashboard/stores?inspect=${encodeURIComponent(data.url || `https://${data.host}`)}`;

  return (
    <div className={compact ? "bg-card border border-border rounded-xl p-3.5 space-y-2.5" : "bg-card border border-border rounded-xl p-4 space-y-3"}>
      <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
        {store?.logoUrl ? (
          <img src={store.logoUrl} alt="" className="w-5 h-5 rounded object-contain shrink-0 bg-muted" />
        ) : (
          <Store className="w-4 h-4 text-primary shrink-0" />
        )}
        <span className="truncate">{store?.name || data.host}</span>
        {store?.name && <span className="font-normal text-muted-foreground truncate">· {data.host}</span>}
      </div>

      {shown.length > 0 ? (
        <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 sm:grid-cols-3 gap-2"}>
          {shown.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} hint={t.hint} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">We don't track this store yet. Inspect it to see its theme, apps, prices and reviews.</p>
      )}

      {!compact && inspection && inspection.apps.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">Apps</div>
          <div className="flex flex-wrap gap-1.5">
            {inspection.apps.map((a) => (
              <span key={a.name} title={a.category} className="text-xs px-2 py-0.5 rounded-md bg-muted">
                {a.name}
              </span>
            ))}
            {inspection.appCount > inspection.apps.length && (
              <span className="text-xs px-2 py-0.5 text-muted-foreground">+{inspection.appCount - inspection.apps.length} more</span>
            )}
          </div>
        </div>
      )}

      {!compact && store && store.bestSellers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">Best sellers</div>
          <ul className="divide-y divide-border">
            {store.bestSellers.map((b) => (
              <li key={b.title} className="flex items-center gap-3 py-1.5 text-xs">
                {b.imageUrl ? <img src={b.imageUrl} alt="" loading="lazy" className="w-8 h-8 rounded object-cover shrink-0 bg-muted" /> : null}
                <span className="flex-1 min-w-0 truncate">{b.title}</span>
                {/\d/.test(b.estSalesRange) && <span className="text-muted-foreground shrink-0">{b.estSalesRange}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {store && (
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link to={`/dashboard/stores?store=${store._id}`}>
              <Store className="w-3.5 h-3.5 mr-1.5" />
              Open in Store Tracker
            </Link>
          </Button>
        )}
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to={inspectLink}>
            <ScanSearch className="w-3.5 h-3.5 mr-1.5" />
            {inspection ? "Inspect again" : "Inspect store"}
          </Link>
        </Button>
        {inspection && <span className="text-[11px] text-muted-foreground">Inspected {shortDate(inspection.inspectedAt)}</span>}
      </div>
    </div>
  );
}
