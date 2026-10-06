import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import {
  ShieldCheck, LayoutGrid, Package, Megaphone, Users, Plus, Search,
  Pencil, Trash2, TrendingUp, Bookmark, UserCog, RefreshCw, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { useMutation, useAction } from "convex/react";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AdminGuard from "./_components/AdminGuard.tsx";
import ProductFormDialog from "./_components/ProductFormDialog.tsx";
import AdFormDialog from "./_components/AdFormDialog.tsx";
import DataSourcesPanel from "./_components/DataSourcesPanel.tsx";
import ImportRunsCard from "./_components/ImportRunsCard.tsx";
import CsvImportDialog from "./_components/CsvImportDialog.tsx";
import AdCsvImportDialog from "./_components/AdCsvImportDialog.tsx";
import RemoveLastAdImport from "./_components/RemoveLastAdImport.tsx";
import RemoveProductListingAds from "./_components/RemoveProductListingAds.tsx";

type Tab = "overview" | "products" | "ads" | "users";
type Product = Doc<"products">;
type Ad = Doc<"ads">;
type UserDoc = Doc<"users">;

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "products", label: "Products", icon: Package },
    { id: "ads", label: "Ads", icon: Megaphone },
    { id: "users", label: "Users", icon: Users },
  ];

  return (
    <AdminGuard>
      <div className="p-5 lg:p-8 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6"
        >
          <div className="flex items-center gap-2.5 mb-1">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Admin Panel</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage the platform's curated content, users, and view growth stats.
          </p>
        </motion.div>

        <div className="flex items-center gap-2 mb-6 border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px whitespace-nowrap",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab />}
        {tab === "products" && <ProductsTab />}
        {tab === "ads" && <AdsTab />}
        {tab === "users" && <UsersTab />}
      </div>
    </AdminGuard>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function OverviewTab() {
  const stats = useQuery(api.users.getAdminStats, {});
  const mostSaved = useQuery(api.admin.products.getMostSavedProducts, {});

  return (
    <div className="space-y-6">
      {stats === undefined ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Total signups" value={stats.totalUsers} icon={Users} />
          <StatCard label="Admins" value={stats.totalAdmins} icon={UserCog} />
          <StatCard label="Winning products" value={stats.totalProducts} icon={Package} />
          <StatCard label="Curated ads" value={stats.totalAds} icon={Megaphone} />
          <StatCard label="Tracked stores" value={stats.totalStores} icon={TrendingUp} />
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bookmark className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Top Products by Saves</h2>
        </div>
        {mostSaved === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : mostSaved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products have been saved by users yet.</p>
        ) : (
          <div className="space-y-2">
            {mostSaved.map(({ product, saveCount }) => (
              <div key={product._id} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
                <img src={product.imageUrl} alt={product.title} className="w-10 h-10 rounded-md object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{product.title}</div>
                  <div className="text-xs text-muted-foreground">{product.category}</div>
                </div>
                <Badge variant="secondary" className="shrink-0">{saveCount} saves</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PIPELINE_STAGES: Record<string, string> = {
  keys: "Preparing products",
  link: "Linking ads to products",
  aggregate: "Adding up ad numbers",
  winners: "Rebuilding Winning Products",
  snapshotProducts: "Saving product history",
  snapshotAds: "Saving ad history",
  prune: "Removing history older than 90 days",
  done: "Done",
};

function ProductPipelineCard() {
  const status = useQuery(api.productPipeline.status, {});
  const runNow = useMutation(api.productPipeline.runNow);
  const running = status?.state === "running";
  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Products from ads, Winning Products & history</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Links ads to the products they sell and saves today's numbers for the charts, every day at 08:05 UTC. Winning Products get a new
            mix every 3 days (50 per niche, score 65+: the best 25 stay, the rest rotate). "Run now" also draws a new mix today. No API credits used.
          </p>
        </div>
        <Button
          size="sm"
          disabled={running}
          onClick={async () => {
            try {
              const r = await runNow({});
              toast[r.started ? "success" : "info"](r.started ? "Started" : "Already running");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not start");
            }
          }}
        >
          {running ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          {running ? "Running…" : "Run now"}
        </Button>
      </div>
      {status && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs">
          <span className="text-muted-foreground">
            Status <strong className={cn("text-foreground", status.state === "error" && "text-destructive")}>
              {status.state === "running" ? PIPELINE_STAGES[status.stage] ?? status.stage : status.state === "done" ? `Done ${new Date(status.finishedAt ?? status.startedAt).toLocaleString()}` : "Failed"}
            </strong>
          </span>
          <span className="text-muted-foreground">Products created from ads <strong className="text-foreground">{status.counts.productsCreated}</strong></span>
          <span className="text-muted-foreground">Ads linked <strong className="text-foreground">{status.counts.adsLinked}</strong></span>
          <span className="text-muted-foreground">Winners <strong className="text-foreground">{status.counts.winners}</strong></span>
          <span className="text-muted-foreground">History rows <strong className="text-foreground">{status.counts.snapshots}</strong></span>
          {status.error && <div className="w-full text-destructive">{status.error}</div>}
        </div>
      )}
    </div>
  );
}

function ProductsTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [lastPricing, setLastPricing] = useState<{ updated: number; skipped: number; errors: string[] } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [lastDiscovery, setLastDiscovery] = useState<{ created: number; updated: number; skipped: number; errors: string[]; bySource?: Record<string, { created: number; updated: number }>; stores?: number; sample?: string } | null>(null);
  const deleteProduct = useMutation(api.admin.products.deleteProduct);
  const backfillPricing = useAction(api.nexscope.pricing.backfillPricingNow);
  const discoverProducts = useAction(api.nexscope.productDiscovery.discoverProductsNow);

  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.products.listProducts,
    { search: debouncedSearch || undefined },
    { initialNumItems: 20 }
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProduct({ id: deleteTarget._id });
      toast.success("Product deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete product";
      toast.error(message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handlePricingBackfill = async () => {
    setPricing(true);
    try {
      const result = await backfillPricing({});
      setLastPricing(result);
      if (result.errors.length > 0) {
        toast.error(`Priced with ${result.errors.length} error(s) — see details below`);
      } else {
        toast.success(`Priced ${result.updated} product(s) via Nexscope.ai`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch pricing from Nexscope.ai";
      toast.error(message);
    } finally {
      setPricing(false);
    }
  };

  const handleDiscovery = async () => {
    setDiscovering(true);
    try {
      const result = await discoverProducts({});
      setLastDiscovery(result);
      if (result.errors.length > 0) {
        toast.error(`Discovered with ${result.errors.length} error(s) — see details below`);
      } else {
        toast.success(`Discovered ${result.created} new, ${result.updated} updated Amazon products`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to discover products from Nexscope.ai";
      toast.error(message);
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div>
      <ProductPipelineCard />
      <div className="bg-card border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Nexscope.ai product discovery</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Pulls real products from three places: Amazon bestsellers and Shopify store products running Facebook ads (up to 10 per niche each), plus the top 10 TikTok Shop best-sellers. Each with its own real title, image and price. Shopify products also add their store to the Stores tracker. Every run searches a different keyword per niche, so it keeps finding new products. Also runs automatically once a day. Each run uses Nexscope credits (13 searches).
            </p>
          </div>
          <Button size="sm" onClick={handleDiscovery} disabled={discovering}>
            {discovering ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            {discovering ? "Discovering..." : "Discover products now"}
          </Button>
        </div>
        {lastDiscovery && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs">
            <span className="text-muted-foreground">Created <strong className="text-foreground">{lastDiscovery.created}</strong></span>
            <span className="text-muted-foreground">Updated <strong className="text-foreground">{lastDiscovery.updated}</strong></span>
            <span className="text-muted-foreground">Skipped <strong className="text-foreground">{lastDiscovery.skipped}</strong></span>
            {Object.entries(lastDiscovery.bySource ?? {}).map(([source, c]) => (
              <span key={source} className="text-muted-foreground">
                {source}: <strong className="text-foreground">{c.created}</strong> new, {c.updated} updated
              </span>
            ))}
            {lastDiscovery.sample && (
              <details className="w-full text-muted-foreground">
                <summary className="cursor-pointer">What Nexscope sent for one Shopify product</summary>
                <div className="mt-1 break-all font-mono text-[11px]">{lastDiscovery.sample}</div>
              </details>
            )}
            {lastDiscovery.stores !== undefined && (
              <span className="text-muted-foreground">New stores <strong className="text-foreground">{lastDiscovery.stores}</strong></span>
            )}
            {lastDiscovery.errors.length > 0 && (
              <div className="w-full text-destructive">
                {lastDiscovery.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Nexscope.ai pricing backfill</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Fills price/cost on AdLibrary-synced products with an estimated market benchmark from Amazon listings. Also runs automatically once a day. Each run uses Nexscope credits.
            </p>
          </div>
          <Button size="sm" onClick={handlePricingBackfill} disabled={pricing}>
            {pricing ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            {pricing ? "Pricing..." : "Backfill pricing now"}
          </Button>
        </div>
        {lastPricing && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs">
            <span className="text-muted-foreground">Updated <strong className="text-foreground">{lastPricing.updated}</strong></span>
            <span className="text-muted-foreground">Skipped <strong className="text-foreground">{lastPricing.skipped}</strong></span>
            {lastPricing.errors.length > 0 && (
              <div className="w-full text-destructive">
                {lastPricing.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={() => setCsvOpen(true)}>
          <Upload className="w-4 h-4 mr-1.5" />
          Import CSV
        </Button>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add product
        </Button>
      </div>
      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} />

      {status === "LoadingFirstPage" ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Package /></EmptyMedia>
            <EmptyTitle>No products found</EmptyTitle>
            <EmptyDescription>Add your first winning product to get started.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add product
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>AI score</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((product) => (
                  <TableRow key={product._id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <img src={product.imageUrl} alt={product.title} className="w-8 h-8 rounded-md object-cover shrink-0" />
                        <span className="font-medium truncate max-w-[220px]">{product.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{product.category}</TableCell>
                    <TableCell>
                      {product.price !== undefined ? (
                        <>
                          ${product.price.toFixed(2)}
                          {product.priceSource === "estimated_market" && (
                            <span className="text-[10px] text-muted-foreground ml-1">(est.)</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{product.aiScore}</Badge>
                    </TableCell>
                    <TableCell>
                      {product.isWinnerOfDay ? <Badge>Yes</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.source === "adlibrary_api" ? "AdLibrary" : product.source === "nexscope_api" ? "Amazon" : product.source === "tiktok_shop" ? "TikTok Shop" : product.source === "shopify" ? "Shopify" : product.source === "csv_import" ? "CSV" : product.source === "winninghunter" ? "WinningHunter" : "Curated"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => { setEditing(product); setFormOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(product)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-6">
              <Button variant="secondary" onClick={() => loadMore(20)}>Load more</Button>
            </div>
          )}
        </>
      )}

      <ProductFormDialog product={editing} open={formOpen} onOpenChange={setFormOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the product from Winning Products. Users who saved it will no longer see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdsTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Ad | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Ad | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    enriched?: number;
    skippedNoText?: number;
    skippedNoCountry?: number;
    sampleGeo?: string[];
    sampleKeys?: string[];
    creditsUsed: number;
    creditsRemaining: number | null;
    errors: string[];
    productsCreated: number;
    productsUpdated: number;
  } | null>(null);
  const deleteAd = useMutation(api.admin.ads.deleteAd);
  const syncAdLibrary = useAction(api.adlibrary.sync.syncNow);

  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.ads.listAds,
    { search: debouncedSearch || undefined },
    { initialNumItems: 20 }
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAd({ id: deleteTarget._id });
      toast.success("Ad deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete ad";
      toast.error(message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSync = async (nicheLimit?: number) => {
    setSyncing(true);
    try {
      const result = await syncAdLibrary(nicheLimit ? { nicheLimit } : {});
      setLastSync(result);
      if (result.errors.length > 0) {
        toast.error(`Synced with ${result.errors.length} error(s) — see details below`);
      } else {
        toast.success(`Synced: ${result.created} new, ${result.updated} updated ads`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync from AdLibrary.com";
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <ImportRunsCard />
      <DataSourcesPanel />
      <div className="bg-card border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">AdLibrary.com sync</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Pulls real running ads for each curated niche, and the top-performing ad per niche also becomes a real Winning Product. Also runs automatically once a day. Each run uses AdLibrary credits.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleSync(1)} disabled={syncing}>
              Test run (1 credit)
            </Button>
            <Button size="sm" onClick={() => handleSync()} disabled={syncing}>
              {syncing ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
          </div>
        </div>
        {lastSync && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs">
            <span className="text-muted-foreground">Ads fetched <strong className="text-foreground">{lastSync.fetched}</strong></span>
            <span className="text-muted-foreground">Ads created <strong className="text-foreground">{lastSync.created}</strong></span>
            <span className="text-muted-foreground">Ads updated <strong className="text-foreground">{lastSync.updated}</strong></span>
            <span className="text-muted-foreground">Enriched (audience/spend) <strong className="text-foreground">{lastSync.enriched ?? 0}</strong></span>
            <span className="text-muted-foreground">Skipped: no text <strong className="text-foreground">{lastSync.skippedNoText ?? 0}</strong></span>
            <span className="text-muted-foreground">Skipped: country not covered <strong className="text-foreground">{lastSync.skippedNoCountry ?? 0}</strong></span>
            {!!lastSync.sampleGeo?.length && (
              <div className="w-full text-muted-foreground break-all">Sample countries of skipped ads: {lastSync.sampleGeo.join(" · ")}</div>
            )}
            {lastSync.created + lastSync.updated === 0 && !!lastSync.sampleKeys?.length && (
              <div className="w-full text-muted-foreground break-all">Fields returned: {lastSync.sampleKeys.join(", ")}</div>
            )}
            <span className="text-muted-foreground">Products created <strong className="text-foreground">{lastSync.productsCreated}</strong></span>
            <span className="text-muted-foreground">Products updated <strong className="text-foreground">{lastSync.productsUpdated}</strong></span>
            <span className="text-muted-foreground">Credits used <strong className="text-foreground">{lastSync.creditsUsed}</strong></span>
            {lastSync.creditsRemaining !== null && (
              <span className="text-muted-foreground">Credits remaining <strong className="text-foreground">{lastSync.creditsRemaining}</strong></span>
            )}
            {lastSync.errors.length > 0 && (
              <div className="w-full text-destructive">
                {lastSync.errors.map((err, i) => <div key={i}>{err}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ads..."
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={() => setCsvOpen(true)}>
          <Upload className="w-4 h-4 mr-1.5" />
          Import CSV
        </Button>
        <RemoveLastAdImport />
        <RemoveProductListingAds />
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add ad
        </Button>
      </div>
      <AdCsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} />

      {status === "LoadingFirstPage" ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Megaphone /></EmptyMedia>
            <EmptyTitle>No ads found</EmptyTitle>
            <EmptyDescription>Curate your first TikTok or global ad example.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add ad
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Niche</TableHead>
                  <TableHead>Spend est.</TableHead>
                  <TableHead>AI score</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((ad) => (
                  <TableRow key={ad._id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <img src={ad.creativeUrl} alt={ad.advertiserName} className="w-8 h-8 rounded-md object-cover shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium truncate max-w-[180px]">{ad.advertiserName}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">{ad.headline}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ad.platform}</TableCell>
                    <TableCell className="text-muted-foreground">{ad.niche}</TableCell>
                    <TableCell className="text-muted-foreground">{ad.spendEstimate}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ad.aiScore}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {({ adlibrary_api: "AdLibrary", meta_ad_library: "Meta", apify: "Apify", nexscope: "Nexscope", extension: "Extension", winninghunter: "WinningHunter", csv_import: "CSV" } as Record<string, string>)[ad.source] ?? "Curated"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => { setEditing(ad); setFormOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(ad)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-6">
              <Button variant="secondary" onClick={() => loadMore(20)}>Load more</Button>
            </div>
          )}
        </>
      )}

      <AdFormDialog ad={editing} open={formOpen} onOpenChange={setFormOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ad?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes "{deleteTarget?.advertiserName}" from Ad Spy. Users who saved it will no longer see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const setUserRole = useMutation(api.users.setUserRole);

  const { results, status, loadMore } = usePaginatedQuery(
    api.users.listUsers,
    { search: debouncedSearch || undefined },
    { initialNumItems: 20 }
  );

  const handleToggleAdmin = async (user: UserDoc) => {
    const newRole = user.role === "admin" ? "user" : "admin";
    try {
      await setUserRole({ userId: user._id, role: newRole });
      toast.success(newRole === "admin" ? "Granted admin access" : "Removed admin access");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update role";
      toast.error(message);
    }
  };

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email..."
          className="pl-9 max-w-sm"
        />
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Users /></EmptyMedia>
            <EmptyTitle>No users found</EmptyTitle>
            <EmptyDescription>Try a different search term.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((user) => (
                  <TableRow key={user._id}>
                    <TableCell className="font-medium">{user.name ?? "Unnamed user"}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"} className="capitalize">
                        {user.role ?? "user"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.customerId ? "Connected" : "No subscription"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleToggleAdmin(user)}
                      >
                        {user.role === "admin" ? "Remove admin" : "Make admin"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-6">
              <Button variant="secondary" onClick={() => loadMore(20)}>Load more</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
