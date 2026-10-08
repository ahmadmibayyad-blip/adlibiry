import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ExternalLink, Rocket } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import ProductImage from "@/components/ProductImage.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Every product page launched to Shopify (convex/launch.ts), newest first.
const STATUS: Record<string, string> = {
  generating: "Writing…",
  publishing: "Publishing…",
  published: "In your store",
  failed: "Failed",
};

export default function LaunchesPage() {
  const rows = useQuery(api.launch.mine, {});
  return (
    <div className="p-5 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <Rocket className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold">Launches</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Products you launched to your Shopify store, with their ad kits. Launch more from any product page.</p>
      {rows === undefined ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl text-sm">
          No launches yet. Open a product in <Link className="text-primary underline" to="/dashboard/winners">Winning Products</Link> and press Launch.
        </div>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-xl bg-card">
          {rows.map((l) => (
            <li key={l._id} className="flex items-center gap-3 p-3">
              <ProductImage src={l.product?.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover bg-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <Link to={`/dashboard/products/${l.productId}`} className="text-sm font-medium line-clamp-1 hover:underline">
                  {(l.copy as { title?: string } | undefined)?.title ?? l.product?.title ?? "Product"}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {STATUS[l.status] ?? l.status}
                  {l.status === "published" ? (l.publish === "DRAFT" ? " (draft)" : " (live)") : ""} · {l.shopDomain} · {new Date(l.createdAt).toLocaleDateString()}
                  {l.price ? ` · ${l.price.toFixed(2)}` : ""}
                </div>
                {l.status === "failed" && l.error && <div className="text-xs text-bad mt-0.5">{l.error}</div>}
              </div>
              {l.adminUrl && (
                <a href={l.adminUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Shopify
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
