import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { CircleCheck, CopyCheck, ExternalLink, Link2, Megaphone, MoreHorizontal, Rocket, RotateCw, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import ProductImage from "@/components/ProductImage.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import StoreCheck from "@/components/StoreCheck.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.tsx";
import AdKit from "@/pages/dashboard/products/_components/AdKit.tsx";
import DeleteLaunches from "./_components/DeleteLaunches.tsx";
import RelaunchDialog from "./_components/RelaunchDialog.tsx";
import MakeLive from "./_components/MakeLive.tsx";
import LaunchDialog from "@/pages/dashboard/products/_components/LaunchDialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";

// Every product page launched to Shopify (convex/launch.ts), newest first, grouped by product
// (the live one leads its group). The header shows the quota (api.launch.myQuota) and the
// connected store; Shopify's OAuth answer lands here via /dashboard/launch/shopify-callback.
const STATUS: Record<string, string> = {
  generating: "Writing…",
  publishing: "Publishing…",
  published: "In your store",
  failed: "Failed",
};
const GROUPS_PER_PAGE = 20;

// Row actions: 40px tall on touch screens, 32px from sm up.
const ACTION = "inline-flex items-center gap-1 text-xs border border-border rounded-md px-2.5 h-10 sm:h-8 hover:bg-muted shrink-0";

type LaunchRow = Doc<"launches"> & { product?: { imageUrl?: string; title?: string; imported?: boolean } | null };

function money(amount: number, currency?: string) {
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    /* unknown currency code */
  }
  return amount.toFixed(2);
}

// The page a Store Inspector "Mirror" link asked for, kept for this tab until it can be used.
const MIRROR_KEY = "adspy.launch.mirror";
function savedMirror() {
  try {
    return sessionStorage.getItem(MIRROR_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveMirror(url: string | null) {
  try {
    if (url) sessionStorage.setItem(MIRROR_KEY, url);
    else sessionStorage.removeItem(MIRROR_KEY);
  } catch {
    /* storage blocked */
  }
}
const hostOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split(/[/?]/)[0];

/** The title a launch row shows: the launch's own copy, else the product's. */
const displayTitle = (l: LaunchRow) => ((l.copy as { title?: string } | undefined)?.title ?? l.product?.title ?? "").trim();

/** "Økologisk bivoks brødpose – 100 % bomuld" and "økologisk bivoks brødpose 100% bomuld" group together. */
function groupKey(title: string) {
  return title
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "Live store", "Theme ready", "Draft"…: what the launch is now, at a glance. */
function StatusBadge({ l }: { l: LaunchRow }) {
  if (l.status === "published" && l.mode === "store" && l.themeLive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-good/10 text-good px-2 py-0.5 text-[11px] font-semibold">
        <CircleCheck className="w-3 h-3" /> Live store
      </span>
    );
  }
  const label =
    l.status === "published"
      ? l.mode === "store"
        ? "Theme ready, not live"
        : l.publish === "DRAFT"
          ? "Draft in Shopify"
          : "Live product"
      : STATUS[l.status] ?? l.status;
  const tone = l.status === "failed" ? "bg-bad/10 text-bad" : l.status === "published" ? "bg-muted text-foreground" : "bg-primary/10 text-primary";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{label}</span>;
}

function Row({
  l,
  currency,
  showDomain,
  earlier,
  onAds,
  onRelaunch,
  onMakeLive,
  onDelete,
}: {
  l: LaunchRow;
  currency?: string;
  showDomain: boolean;
  earlier?: boolean;
  onAds: () => void;
  onRelaunch: () => void;
  onMakeLive?: () => void;
  onDelete: () => void;
}) {
  const title = displayTitle(l) || "Product";
  const busy = l.status === "generating" || l.status === "publishing";
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3", earlier && "bg-muted/30")}>
      <ProductImage src={l.product?.imageUrl} alt="" className={cn("rounded-md object-cover bg-muted shrink-0", earlier ? "w-9 h-9" : "w-12 h-12")} />
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {l.product?.imported || earlier ? (
            <span className="text-sm font-medium line-clamp-1">{title}</span>
          ) : (
            <Link to={`/dashboard/products/${l.productId}`} className="text-sm font-medium line-clamp-1 hover:underline">
              {title}
            </Link>
          )}
          <StatusBadge l={l} />
        </div>
        <div className="text-xs text-muted-foreground">
          {[
            l.mode === "store" ? `Full store${l.brandName ? ` · ${l.brandName}` : ""}` : "Product page",
            when(l.createdAt),
            l.price ? money(l.price, currency) : "",
            showDomain ? l.shopDomain : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {l.status === "failed" && l.error && <div className="text-xs text-bad">{l.error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {l.status === "published" && (l.copy as { adKit?: unknown[] } | undefined)?.adKit?.length ? (
          <button type="button" onClick={onAds} className={ACTION}>
            <Megaphone className="w-3.5 h-3.5" />
            Ads
          </button>
        ) : null}
        {onMakeLive && l.status === "published" && l.mode === "store" && l.themeId && !l.themeLive ? (
          l.step === "going-live" ? (
            <span className={cn(ACTION, "text-muted-foreground hover:bg-transparent")}>
              <Spinner className="w-3.5 h-3.5" />
              Going live…
            </span>
          ) : (
            <button type="button" onClick={onMakeLive} title="Make this store's theme the one your customers see" className={cn(ACTION, "border-primary/30 text-primary")}>
              <CircleCheck className="w-3.5 h-3.5" />
              Make live
            </button>
          )
        ) : null}
        {l.themePreviewUrl && (
          <a href={l.themePreviewUrl} target="_blank" rel="noopener noreferrer" className={ACTION}>
            <ExternalLink className="w-3.5 h-3.5" />
            Preview
          </a>
        )}
        {l.adminUrl && (
          <a href={l.adminUrl} target="_blank" rel="noopener noreferrer" className={ACTION}>
            <ExternalLink className="w-3.5 h-3.5" />
            Shopify
          </a>
        )}
        {(l.status === "published" || l.status === "failed") && (
          <button type="button" onClick={onRelaunch} title={l.status === "failed" ? "Try again with the same settings" : "Relaunch with the same settings"} className={ACTION}>
            <RotateCw className="w-3.5 h-3.5" />
            {l.status === "failed" ? "Try again" : "Relaunch"}
          </button>
        )}
        {!busy && (
          // Delete sits in a menu, away from Relaunch, so a slip on a phone can't hit it.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More actions" className="inline-flex items-center justify-center w-10 h-10 sm:w-8 sm:h-8 rounded-md text-muted-foreground hover:bg-muted shrink-0">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete launch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/** "Reading the product… 12s": AliExpress can take up to a minute, so show that time is passing. */
function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return s >= 3 ? <span className="tabular-nums"> {s}s</span> : null;
}

export default function LaunchesPage() {
  const rows = useQuery(api.launch.mine, {}) as LaunchRow[] | undefined;
  const quota = useQuery(api.launch.myQuota, {});
  const [params, setParams] = useSearchParams();
  const [adsFor, setAdsFor] = useState<Id<"launches"> | null>(null);
  const adsLaunch = rows?.find((l) => l._id === adsFor);
  const [toDelete, setToDelete] = useState<Id<"launches">[] | null>(null);
  // A copy, not a lookup: a relaunch that replaces this launch removes its row while the dialog shows progress.
  const [relaunching, setRelaunching] = useState<Doc<"launches"> | null>(null);
  const [goingLive, setGoingLive] = useState<Id<"launches"> | null>(null);
  const goLiveLaunch = rows?.find((l) => l._id === goingLive);
  const importLink = useAction(api.productImport.importLink);
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);
  const [fromLink, setFromLink] = useState<{ _id: Id<"importedProducts">; imageUrl: string } | null>(null);
  // The page the launch mirrors (Mirror a page; Store Inspector links here with ?mirror=<product page>).
  const [mirror, setMirror] = useState("");
  const [mirrorPage, setMirrorPage] = useState(() => params.get("mirror") ?? savedMirror());
  const [mirrorProduct, setMirrorProduct] = useState("");
  const [mirroring, setMirroring] = useState(false);
  // On phones one form shows at a time; from md up both sit side by side.
  const [tool, setTool] = useState<"link" | "mirror">(() => (params.get("mirror") || savedMirror() ? "mirror" : "link"));
  const [shown, setShown] = useState(GROUPS_PER_PAGE);
  useEffect(() => {
    if (!params.has("mirror")) return;
    saveMirror(params.get("mirror"));
    params.delete("mirror");
    setParams(params, { replace: true });
  }, [params, setParams]);
  // Without a store or the plan the forms don't show: the page to mirror waits (and survives Shopify's OAuth round trip).
  const canLaunch = !!quota?.store && !!quota.allowed;
  const mirrorWaiting = !!quota && !canLaunch && !!mirrorPage.trim();
  useEffect(() => {
    if (canLaunch) saveMirror(null);
  }, [canLaunch]);
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

  // One group per product: the live launch first, then the newest; older ones fold away. The same
  // product imported twice from a link is two records, often with slightly different titles, so
  // the title the row shows (punctuation and case aside) groups them.
  const groups: LaunchRow[][] = [];
  const byProduct = new Map<string, LaunchRow[]>();
  for (const l of rows ?? []) {
    const key = groupKey(displayTitle(l)) || l.productId;
    const g = byProduct.get(key);
    if (g) g.push(l);
    else {
      const list = [l];
      byProduct.set(key, list);
      groups.push(list);
    }
  }
  for (const g of groups) g.sort((a, b) => Number(!!b.themeLive) - Number(!!a.themeLive));
  const currencyOf = (l: LaunchRow) => (l.facts as { currency?: string } | undefined)?.currency ?? (l.shopDomain === quota?.store?.shopDomain ? quota?.store?.currency : undefined);
  const showDomain = (l: LaunchRow) => !!quota?.store && l.shopDomain !== quota.store.shopDomain;
  const rowProps = (l: LaunchRow) => ({
    l,
    currency: currencyOf(l),
    showDomain: showDomain(l),
    onAds: () => setAdsFor(l._id),
    onRelaunch: () => setRelaunching(l),
    // The theme goes live in the store that's connected now, so only its launches offer it.
    onMakeLive: showDomain(l) ? undefined : () => setGoingLive(l._id),
    onDelete: () => setToDelete([l._id]),
  });

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
      <p className="text-sm text-muted-foreground mb-6">Products you launched to your Shopify store, with their ad kits. Launch more from any product page.</p>
      {mirrorWaiting && quota && (
        <div role="status" className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 max-w-md space-y-3">
          <p className="text-sm flex gap-2">
            <CopyCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>
              You were mirroring <strong className="break-all">{hostOf(mirrorPage)}</strong>:{" "}
              {!quota.allowed
                ? quota.store
                  ? "upgrade to Pro to continue."
                  : "connect your Shopify store and upgrade to Pro to continue."
                : "connect your Shopify store to continue."}{" "}
              We keep the page, so it's filled in when you're back.
            </span>
          </p>
          {!quota.store && <ConnectShopify />}
          <div className="flex items-center gap-2 flex-wrap">
            {!quota.allowed && (
              <Button asChild size="sm">
                <Link to="/#pricing">See plans</Link>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMirrorPage("");
                saveMirror(null);
              }}
            >
              Forget this page
            </Button>
          </div>
        </div>
      )}
      {canLaunch && (
        <section aria-label="Start a launch" className="mb-8">
          <div className="md:hidden mb-3 grid grid-cols-2 rounded-lg border border-border p-1 text-sm" role="group" aria-label="How to launch">
            {(
              [
                ["link", "From a link", Link2],
                ["mirror", "Mirror a page", CopyCheck],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tool === key}
                onClick={() => setTool(key)}
                className={cn("h-10 rounded-md inline-flex items-center justify-center gap-1.5", tool === key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground")}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <form
              className={cn("rounded-xl border border-border bg-card p-4 space-y-2", tool !== "link" && "hidden md:block")}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!link.trim()) return;
                setReading(true);
                try {
                  const r = await importLink({ url: link.trim() });
                  setMirror("");
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
              <Input id="launch-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="AliExpress, Shopify store or other product page link" />
              <Button type="submit" className="w-full h-10" disabled={reading || !link.trim()}>
                {reading ? <Spinner className="w-4 h-4 mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
                {reading ? (
                  <>
                    Reading the product…
                    <Elapsed />
                  </>
                ) : (
                  "Read product"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Any product you found yourself: we read its title, photos and price, and you launch it like a winning product. AliExpress links can take up to a minute.
              </p>
            </form>
            {/* Mirror a page: our store built like a page that sells, for the user's own product (or that page's). */}
            <form
              className={cn("rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2", tool !== "mirror" && "hidden md:block")}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!mirrorPage.trim()) return;
                setMirroring(true);
                try {
                  const r = await importLink({ url: (mirrorProduct.trim() || mirrorPage).trim() });
                  setMirror(mirrorPage.trim());
                  setFromLink({ _id: r.productId, imageUrl: r.imageUrl });
                  setMirrorPage("");
                  setMirrorProduct("");
                } catch (err) {
                  toast.error(errorMessage(err, "Couldn't read that link"));
                } finally {
                  setMirroring(false);
                }
              }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <CopyCheck className="w-4 h-4 text-primary" /> Mirror a page
              </h2>
              <label htmlFor="mirror-page" className="block text-xs font-medium">
                Page to copy
              </label>
              <Input id="mirror-page" type="url" value={mirrorPage} onChange={(e) => setMirrorPage(e.target.value)} placeholder="https://store.com/products/…" />
              <label htmlFor="mirror-product" className="block text-xs font-medium pt-1">
                Your product <span className="font-normal text-muted-foreground">(optional: AliExpress or store link)</span>
              </label>
              <Input id="mirror-product" type="url" value={mirrorProduct} onChange={(e) => setMirrorProduct(e.target.value)} placeholder="Empty: launch the product on that page" />
              <Button type="submit" className="w-full h-10" disabled={mirroring || !mirrorPage.trim()}>
                {mirroring ? <Spinner className="w-4 h-4 mr-2" /> : <CopyCheck className="w-4 h-4 mr-2" />}
                {mirroring ? (
                  <>
                    Reading the product…
                    <Elapsed />
                  </>
                ) : (
                  "Mirror this page"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                A store built like that page: its section order, bundle deals and buy-box extras, with your own text and photos.
              </p>
            </form>
          </div>
        </section>
      )}
      {fromLink ? (
        <LaunchDialog
          key={fromLink._id}
          product={fromLink}
          startOpen
          mirrorUrl={mirror || undefined}
          onClose={() => {
            setFromLink(null);
            setMirror("");
          }}
        />
      ) : null}
      {quota && !quota.store && !mirrorWaiting && (
        <div className="mb-6 rounded-xl border border-dashed border-primary/20 bg-primary/10 p-4 max-w-sm space-y-3">
          <p className="text-sm">Connect your Shopify store to launch winning products as ready-made product pages.</p>
          <ConnectShopify />
        </div>
      )}
      <section aria-labelledby="your-launches">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <h2 id="your-launches" className="text-lg font-semibold">
            Your launches
            {rows?.length ? (
              <>
                {/* Read as "Your launches, 20", shown as a count pill beside the heading. */}
                <span className="sr-only">,</span>{" "}
                <span className="ml-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-medium text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </>
            ) : null}
          </h2>
          {failed.length ? (
            <button type="button" onClick={() => setToDelete(failed.map((l) => l._id))} className={ACTION}>
              <Trash2 className="w-3.5 h-3.5" />
              Clear failed ({failed.length})
            </button>
          ) : null}
        </div>
        {rows === undefined ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl text-sm">
            No launches yet. Open a product in <Link className="text-primary underline" to="/dashboard/winners">Winning Products</Link> and press Launch.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border border border-border rounded-xl bg-card overflow-hidden">
              {groups.slice(0, shown).map(([first, ...older]) => (
                <li key={first._id}>
                  <ul>
                    <Row {...rowProps(first)} />
                  </ul>
                  {older.length ? (
                    <details className="group border-t border-border/60">
                      <summary className="cursor-pointer select-none px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground list-none [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">Show {older.length} earlier {older.length === 1 ? "launch" : "launches"} of this product</span>
                        <span className="hidden group-open:inline">Hide earlier launches</span>
                      </summary>
                      <ul className="divide-y divide-border/60 border-t border-border/60">
                        {older.map((l) => (
                          <Row key={l._id} {...rowProps(l)} earlier />
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
            {groups.length > shown ? (
              <Button variant="outline" className="mt-3 w-full h-10" onClick={() => setShown((n) => n + GROUPS_PER_PAGE)}>
                Show more ({groups.length - shown} more {groups.length - shown === 1 ? "product" : "products"})
              </Button>
            ) : null}
          </>
        )}
      </section>
      {relaunching ? <RelaunchDialog key={relaunching._id} launch={relaunching} aiPhotosReady={!!quota?.aiPhotosReady} onClose={() => setRelaunching(null)} /> : null}
      {goLiveLaunch ? <MakeLive key={goLiveLaunch._id} launch={goLiveLaunch} open onOpenChange={(o) => !o && setGoingLive(null)} /> : null}
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
