import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ExternalLink, Link2, Megaphone, Rocket, RotateCw, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import ProductImage from "@/components/ProductImage.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import StoreCheck from "@/components/StoreCheck.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import AdKit from "@/pages/dashboard/products/_components/AdKit.tsx";
import DeleteLaunches from "./_components/DeleteLaunches.tsx";
import RelaunchDialog from "./_components/RelaunchDialog.tsx";
import LaunchDialog from "@/pages/dashboard/products/_components/LaunchDialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";

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
  const [adsFor, setAdsFor] = useState<Id<"launches"> | null>(null);
  const adsLaunch = rows?.find((l) => l._id === adsFor);
  const [toDelete, setToDelete] = useState<Id<"launches">[] | null>(null);
  // A copy, not a lookup: a relaunch that replaces this launch removes its row while the dialog shows progress.
  const [relaunching, setRelaunching] = useState<Doc<"launches"> | null>(null);
  const importLink = useAction(api.productImport.importLink);
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);
  const [fromLink, setFromLink] = useState<{ _id: Id<"importedProducts">; imageUrl: string } | null>(null);
  const failed = rows?.filter((l) => l.status === "failed") ?? [];
  const deleting = rows?.filter((l) => toDelete?.includes(l._id)) ?? [];

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
          <div className="flex items-center gap-2 text-xs flex-wrap">
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
            {quota.store && <StoreCheck />}
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
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <p className="text-sm text-muted-foreground">Products you launched to your Shopify store, with their ad kits. Launch more from any product page.</p>
        {failed.length ? (
          <button type="button" onClick={() => setToDelete(failed.map((l) => l._id))} className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
            Clear failed ({failed.length})
          </button>
        ) : null}
      </div>
      {quota?.store && quota.allowed && (
        <form
          className="mb-6 rounded-xl border border-border bg-card p-4 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!link.trim()) return;
            setReading(true);
            try {
              const r = await importLink({ url: link.trim() });
              setFromLink({ _id: r.productId, imageUrl: r.imageUrl });
              setLink("");
            } catch (err) {
              toast.error(errorMessage(err, "Couldn't read that link"));
            } finally {
              setReading(false);
            }
          }}
        >
          <label htmlFor="launch-link" className="text-sm font-semibold flex items-center gap-1.5">
            <Link2 className="w-4 h-4 text-primary" /> Launch from a link
          </label>
          <div className="flex gap-2 flex-wrap">
            <Input id="launch-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="AliExpress, Shopify store or other product page link" className="flex-1 min-w-48" />
            <Button type="submit" disabled={reading || !link.trim()}>
              {reading ? <Spinner className="w-4 h-4 mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
              {reading ? "Reading the product…" : "Launch"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Any product you found yourself: we read its title, photos and price, and you launch it like a winning product. AliExpress links can take up to a minute.
          </p>
        </form>
      )}
      {fromLink ? <LaunchDialog key={fromLink._id} product={fromLink} startOpen onClose={() => setFromLink(null)} /> : null}
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
            <li key={l._id} className="flex flex-wrap items-center gap-3 p-3">
              <ProductImage src={l.product?.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover bg-muted shrink-0" />
              <div className="min-w-0 flex-1 basis-48">
                {l.product?.imported ? (
                  <span className="text-sm font-medium line-clamp-1">{(l.copy as { title?: string } | undefined)?.title ?? l.product.title}</span>
                ) : (
                  <Link to={`/dashboard/products/${l.productId}`} className="text-sm font-medium line-clamp-1 hover:underline">
                    {(l.copy as { title?: string } | undefined)?.title ?? l.product?.title ?? "Product"}
                  </Link>
                )}
                <div className="text-xs text-muted-foreground">
                  {l.mode === "store" ? `Full store${l.brandName ? ` “${l.brandName}”` : ""} · ` : ""}
                  {STATUS[l.status] ?? l.status}
                  {l.status === "published" ? (l.mode === "store" ? (l.themeLive ? " (live theme)" : " (theme not live yet)") : l.publish === "DRAFT" ? " (draft)" : " (live)") : ""} · {l.shopDomain} · {new Date(l.createdAt).toLocaleDateString()}
                  {l.price ? ` · ${l.price.toFixed(2)}` : ""}
                </div>
                {l.status === "failed" && l.error && <div className="text-xs text-bad mt-0.5">{l.error}</div>}
              </div>
              {l.status === "published" && (l.copy as { adKit?: unknown[] } | undefined)?.adKit?.length ? (
                <button type="button" onClick={() => setAdsFor(l._id)} className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
                  <Megaphone className="w-3.5 h-3.5" />
                  Ads
                </button>
              ) : null}
              {l.themePreviewUrl && (
                <a href={l.themePreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Preview store
                </a>
              )}
              {l.adminUrl && (
                <a href={l.adminUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Shopify
                </a>
              )}
              {(l.status === "published" || l.status === "failed") && (
                <button type="button" onClick={() => setRelaunching(l)} title={l.status === "failed" ? "Try again with the same settings" : "Relaunch with the same settings"} className="inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-8 hover:bg-muted shrink-0">
                  <RotateCw className="w-3.5 h-3.5" />
                  {l.status === "failed" ? "Try again" : "Relaunch"}
                </button>
              )}
              {l.status !== "generating" && l.status !== "publishing" && (
                <button type="button" onClick={() => setToDelete([l._id])} aria-label="Delete launch" title="Delete launch" className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-bad hover:bg-muted shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {relaunching ? <RelaunchDialog key={relaunching._id} launch={relaunching} aiPhotosReady={!!quota?.aiPhotosReady} onClose={() => setRelaunching(null)} /> : null}
      {deleting.length ? <DeleteLaunches key={deleting.map((l) => l._id).join()} launches={deleting} open onOpenChange={(o) => !o && setToDelete(null)} /> : null}
      <Dialog open={!!adsLaunch} onOpenChange={(o) => !o && setAdsFor(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ads for {(adsLaunch?.copy as { title?: string } | undefined)?.title ?? adsLaunch?.product?.title ?? "this product"}</DialogTitle>
            <DialogDescription>Ad text written from the ads already winning, and ready-made ad images.</DialogDescription>
          </DialogHeader>
          {adsLaunch ? <AdKit l={adsLaunch} ready={!!quota?.aiPhotosReady} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
