import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Play } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { price } from "@/lib/money.ts";

const day = (d?: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : "");

// Store popup: its catalog from our daily checks (best sellers first) and the
// ads linking to its domain (convex/storeSales.ts catalog).
export default function StoreCatalog({ storeId }: { storeId: Id<"stores"> }) {
  const data = useQuery(api.storeSales.catalog, { storeId });
  if (!data || (!data.entries.length && !data.ads.length)) return null;
  return (
    <div className="space-y-5 mt-5">
      {data.ads.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">Ads for this store</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {data.ads.map((a) => (
              <Link key={a._id} to={`/dashboard/ads/${a._id}`} className="group">
                <div className="relative aspect-square rounded-md overflow-hidden bg-muted">
                  <ProductImage src={a.creativeUrl} alt="" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 bg-black/65 text-white text-[10px] rounded px-1">{a.daysRunning}d</span>
                  {a.platform === "TikTok" && <Play className="absolute top-1 right-1 w-3.5 h-3.5 text-white drop-shadow" />}
                </div>
                <div className="text-[11px] mt-1 line-clamp-1 group-hover:underline">{a.headline}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {data.entries.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-semibold text-sm">Catalog</h3>
            <span className="text-xs text-muted-foreground">{data.totalProducts.toLocaleString("en-US")} products</span>
          </div>
          <ul className="divide-y divide-border text-xs">
            {data.entries.slice(0, 30).map((e) => (
              <li key={e.handle} className="flex items-center gap-3 py-1.5">
                <a
                  href={data.origin ? `${data.origin}/products/${e.handle}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 truncate hover:underline capitalize"
                >
                  {e.handle.replace(/-/g, " ")}
                </a>
                {e.estOrders30d !== undefined && <span className="text-good shrink-0">~{e.estOrders30d} orders/30d</span>}
                {e.reviews !== undefined && <span className="text-muted-foreground shrink-0">{e.reviews} reviews</span>}
                {e.firstSeen && <span className="text-muted-foreground shrink-0">new {day(e.firstSeen)}</span>}
                {e.price > 0 && <span className="font-semibold tabular-nums shrink-0">{price(e.price)}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-2">Orders are estimated from how often each product changed in our daily checks.</p>
        </div>
      )}
    </div>
  );
}
