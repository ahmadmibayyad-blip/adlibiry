// DESIGN REFERENCE (Launch feature) — the Launch dashboard.
// Integrated as: src/pages/dashboard/launches/page.tsx
// Routes: /dashboard/launch (canonical), /dashboard/launch/shopify-callback (OAuth return), /dashboard/launches (alias).
// Header data comes from the myQuota public query (see convex_pageGen.ts).
// This file mirrors the integrated source for the design record; edit the repo file, not this one.

import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ExternalLink, Rocket, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import ProductImage from "@/components/ProductImage.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Every product page launched to Shopify (convex/launch.ts), newest first.
// The header shows the quota (api.launch.myQuota) and the connected store;
// Shopify's OAuth answer lands here via /dashboard/launch/shopify-callback.
const STATUS: Record<string, string> = {
  generating: "Writing…",
  publishing: "Publishing…",
  published: "In your store",
  failed: "Failed",
};

export default function LaunchesPage() {
  const rows = useQuery(api.launch.mine, {});
  const quota = useQuery(api.launch.myQuota, {});
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const outcome = params.get("shopify");
    if (!outcome) return;
    if (outcome === "connected") toast.success("Your Shopify store is connected");
    else toast.error(params.get("reason") || "Couldn't connect the store");
    params.delete("shopify");
    params.delete("reason");
    setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- read the OAuth return message once

  return (
    <div className="p-5 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div className="flex items-center gap-2.5">
          <Rocket className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Launch</h1>
        </div>
        {quota && (
          <div className="flex items-center gap-2 text-xs">
            {quota.allowed ? (
              <span className="border border-border rounded-md px-2.5 h-8 inline-flex items-center gap-1.5">
                <Rocket className="w-3.5 h-3.5 text-primary" />
                {quota.allowed.left === null ? "Unlimited launches" : `${quota.allowed.left} of ${quota.allowed.limit} launches left`}
              </span>
            ) : (
              <Link to="/#pricing" className="border border-primary/20 bg-primary/10 rounded-md px-2.5 h-8 inline-flex items-center text-primary">
                Launch is part of Pro — see plans
              </Link>
            )}
            {quota.store && (
              <span className="border border-border rounded-md px-2.5 h-8 inline-flex items-center gap-1.5 text-muted-foreground">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span className="text-foreground">{quota.store.shopName}</span>
                {quota.store.currency}
              </span>
            )}
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-6">Products you launched to your Shopify store, with their ad kits. Launch more from any product page.</p>
      {quota && !quota.store && (
        <div className="mb-6 rounded-xl border border-dashed border-primary/20 bg-primary/10 p-4 max-w-sm space-y-3">
          <p className="text-sm">Connect your Shopify store to launch winning products as ready-made product pages.</p>
          <ConnectShopify />
        </div>
      )}
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
