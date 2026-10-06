import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { compactNumber, domainOf } from "@/lib/adFormat.ts";
import { cn } from "@/lib/utils.ts";

type Product = Doc<"products">;

// Table view for product lists (Products, Winning Products).
export default function ProductTable({ products }: { products: Product[] }) {
  return (
    <div className="border border-border rounded-xl overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="text-xs text-muted-foreground border-b border-border bg-muted/40">
          <tr>
            <th className="text-left font-medium px-3 py-2.5">Product</th>
            <th className="text-right font-medium px-3 py-2.5">Price</th>
            <th className="text-right font-medium px-3 py-2.5">Ads</th>
            <th className="text-right font-medium px-3 py-2.5">Likes</th>
            <th className="text-right font-medium px-3 py-2.5">Growth</th>
            <th className="text-right font-medium px-3 py-2.5">Score</th>
            <th className="text-left font-medium px-3 py-2.5">Category</th>
            <th className="text-left font-medium px-3 py-2.5">Store</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const store = domainOf(p.storeUrl ?? p.supplierUrl);
            const g = p.growthPercent;
            return (
              <tr key={p._id} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link to={`/dashboard/products/${p._id}`} className="flex items-center gap-3 min-w-0">
                    <img src={p.imageUrl} alt="" loading="lazy" className="w-12 h-12 rounded-md object-cover bg-muted shrink-0" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-medium hover:text-primary max-w-[22rem]">{p.title}</span>
                      {(p.winnerRank !== undefined || (p.linkedAds ?? 0) > 0) && (
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          {p.winnerRank !== undefined && (
                            <span className="text-[10px] font-semibold px-1.5 rounded bg-primary/15 text-primary">#{p.winnerRank} in {p.category}</span>
                          )}
                          {(p.linkedAds ?? 0) > 0 && (
                            <span className="text-[10px] font-medium px-1.5 rounded bg-orange-500/15 text-orange-400">From {p.linkedAds} ad{p.linkedAds === 1 ? "" : "s"}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {p.price !== undefined ? `$${p.price.toFixed(2)}` : p.originalPrice ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{compactNumber(p.adsCount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{compactNumber(p.likes)}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {g === undefined ? "—" : (
                    <span className={cn("inline-flex items-center gap-0.5", g >= 0 ? "text-good" : "text-bad")}>
                      {g >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(g).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">{p.aiScore}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{p.category}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[10rem] truncate">{store || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    {(p.storeUrl || p.supplierUrl) && (
                      <a href={p.storeUrl || p.supplierUrl} target="_blank" rel="noopener noreferrer" title="Open store" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {p.researchUrl && (
                      <a href={p.researchUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded border border-border hover:border-primary hover:text-primary whitespace-nowrap">
                        Ads
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
