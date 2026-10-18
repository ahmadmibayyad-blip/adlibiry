import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bookmark, BookmarkCheck, Clock, ExternalLink, Eye, FolderPlus, Layers, Radar, Search, ShoppingBag, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { filterStores, type FoundProduct, type FoundStore, type StoreSort } from "@/convex/lib/offerSearch.ts";
import type { PictureMatch } from "@/convex/lib/aliexpress.ts";
import AddToCollection from "@/components/AddToCollection.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useCpm } from "@/hooks/use-cpm.ts";
import { errorMessage } from "@/lib/errorMessage.ts";
import { formatUsd, spendFromReach } from "@/lib/euSpend.ts";
import { anyCountryName, flagOf } from "@/lib/countries.ts";

// The stores an offer search found, with filters and sorting, their products (from the Shopify store),
// EU reach and estimated spend, and quick actions. Used by Offer Search and Admin → Offer research.

const PAGE = 40;
const ANY = "any";

const libraryUrl = (country: string, s: FoundStore) =>
  s.pageId
    ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&view_all_page_id=${s.pageId}`
    : `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(s.host)}`;

function money(n: number, currency?: string): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
    } catch {
      // Not a currency the browser knows.
    }
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function StoreResults({ stores, country, showCountry }: { stores: FoundStore[]; country?: string; showCountry?: boolean }) {
  const [platform, setPlatform] = useState(ANY);
  const [minAds, setMinAds] = useState(ANY);
  const [minDays, setMinDays] = useState(ANY);
  const [sort, setSort] = useState<StoreSort>("ads");
  const [where, setWhere] = useState(ANY);
  const [shown, setShown] = useState(PAGE);
  const [cpm] = useCpm();

  const countries = useMemo(() => [...new Set(stores.map((s) => s.country).filter((c): c is string => !!c))].sort(), [stores]);
  const list = useMemo(
    () =>
      filterStores(stores, {
        shopifyOnly: platform === "shopify",
        minAds: minAds === ANY ? 0 : Number(minAds),
        minDays: minDays === ANY ? 0 : Number(minDays),
        ...(where !== ANY ? { country: where } : {}),
        sort,
      }),
    [stores, platform, minAds, minDays, where, sort],
  );
  const visible = list.slice(0, shown);
  const states = useQuery(api.offerSearch.storeStates, { hosts: visible.map((s) => s.host) });
  const byHost = new Map((states ?? []).map((s) => [s.host, s]));
  const hasReach = stores.some((s) => s.reach);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {showCountry ? (
          <FilterSelect
            label="Country"
            value={where}
            onChange={setWhere}
            options={[{ value: ANY, label: "All" }, ...countries.map((c) => ({ value: c, label: anyCountryName(c) }))]}
            active={where !== ANY}
          />
        ) : null}
        <FilterSelect
          label="Store"
          value={platform}
          onChange={setPlatform}
          options={[
            { value: ANY, label: "Any" },
            { value: "shopify", label: "Shopify only" },
          ]}
          active={platform !== ANY}
        />
        <FilterSelect
          label="Ads"
          value={minAds}
          onChange={setMinAds}
          options={[{ value: ANY, label: "Any" }, ...["2", "5", "10"].map((n) => ({ value: n, label: `${n}+` }))]}
          active={minAds !== ANY}
        />
        <FilterSelect
          label="Running"
          value={minDays}
          onChange={setMinDays}
          options={[{ value: ANY, label: "Any" }, ...["7", "30", "90"].map((n) => ({ value: n, label: `${n}+ days` }))]}
          active={minDays !== ANY}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as StoreSort)}
          options={[
            { value: "ads", label: "Most ads" },
            { value: "days", label: "Longest running" },
            ...(hasReach ? [{ value: "reach", label: "Biggest EU reach" }] : []),
          ]}
        />
        <span className="text-xs text-muted-foreground">
          {list.length === stores.length ? `${stores.length} stores` : `${list.length} of ${stores.length} stores`}
        </span>
      </div>
      {list.length === 0 && stores.length > 0 ? <p className="text-sm text-muted-foreground">No store matches these filters.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((s) => {
          const state = byHost.get(s.host);
          return <StoreCard key={`${s.country ?? ""}:${s.host}`} store={s} country={s.country ?? country ?? "DK"} showCountry={showCountry} cpm={cpm} storeId={state?.storeId} tracked={!!state?.tracked} />;
        })}
      </div>
      {list.length > shown ? (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({list.length - shown} left)
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StoreCard({
  store: s,
  country,
  showCountry,
  cpm,
  storeId,
  tracked,
}: {
  store: FoundStore;
  country: string;
  showCountry?: boolean;
  cpm: number;
  storeId?: Id<"stores">;
  tracked: boolean;
}) {
  const storeUrl = `https://${s.host}${s.productPaths[0] ?? ""}`;
  const spend = spendFromReach(s.reach, cpm);
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={`https://${s.host}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline break-all inline-block py-2.5 -my-2.5 sm:py-0 sm:my-0">
            {s.host}
          </a>
          <p className="text-xs text-muted-foreground truncate">{s.advertisers.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showCountry && s.country ? (
            <Badge variant="outline" title={anyCountryName(s.country)}>
              {flagOf(s.country)} {s.country}
            </Badge>
          ) : null}
          {s.shopify ? (
            <Badge variant="secondary" className="gap-1">
              <ShoppingBag className="w-3 h-3" /> Shopify
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" /> {s.ads} {s.ads === 1 ? "ad" : "ads"}
          {s.copies > s.ads ? ` (${s.copies} versions)` : ""}
        </span>
        {s.oldestDays > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> oldest running {s.oldestDays} days
          </span>
        ) : null}
        {s.reach ? (
          <span className="inline-flex items-center gap-1" title={`EU reach ${s.reach.toLocaleString("en-US")} × $${cpm} CPM (your CPM in Ad Spy)`}>
            <Users className="w-3.5 h-3.5" /> EU reach {s.reach.toLocaleString("en-US")}
            {spend !== undefined ? <span className="text-foreground font-medium">· ~{formatUsd(spend)} spent</span> : null}
          </span>
        ) : null}
      </div>
      {s.offers.length ? (
        <div className="flex flex-wrap gap-1.5">
          {s.offers.map((o) => (
            <span key={o.label} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
              {o.label}
              {o.count > 1 ? ` ×${o.count}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      {s.products?.length ? (
        <div className="space-y-2">
          {s.products.map((p) => (
            <ProductRow key={p.handle} product={p} currency={s.currency} />
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {s.sample.map((ad) => (
          <a key={ad.id} href={`https://www.facebook.com/ads/library/?id=${ad.id}`} target="_blank" rel="noopener noreferrer" className="group space-y-1">
            {ad.image ? (
              <img src={ad.image} alt="" loading="lazy" className="w-full aspect-square object-cover rounded-md bg-muted" />
            ) : (
              <div className="w-full aspect-square rounded-md bg-muted" />
            )}
            <p className="text-[11px] leading-tight line-clamp-2 group-hover:underline">{ad.headline || "Ad"}</p>
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="h-10 sm:h-8">
          <Link to={`/dashboard/stores?inspect=${encodeURIComponent(storeUrl)}`}>
            <Radar className="w-4 h-4 mr-1.5" /> Inspect store
          </Link>
        </Button>
        <TrackButton store={s} storeId={storeId} tracked={tracked} />
        <CollectionButton store={s} storeId={storeId} />
        {s.advertisers[0] ? (
          <Button asChild size="sm" variant="outline" className="h-10 sm:h-8">
            <Link to={`/dashboard/ad-spy?q=${encodeURIComponent(s.advertisers[0])}`}>
              <Eye className="w-4 h-4 mr-1.5" /> In Ad Spy
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline" className="h-10 sm:h-8">
          <a href={libraryUrl(country, s)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" /> All its ads
          </a>
        </Button>
      </div>
    </div>
  );
}

function ProductRow({ product: p, currency }: { product: FoundProduct; currency?: string }) {
  const find = useAction(api.offerSearch.aliexpressFor);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<PictureMatch[] | null>(null);
  const off = p.price && p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;

  const onFind = async () => {
    if (!p.image) return;
    setBusy(true);
    try {
      const r = await find({ imageUrl: p.image });
      if ("skipped" in r) toast.error(r.skipped);
      else setMatches(r.matches);
    } catch (e) {
      toast.error(errorMessage(e, "The picture search didn't work"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-2 space-y-2">
      <div className="flex gap-3">
        {p.image ? <img src={p.image} alt="" loading="lazy" className="w-16 h-16 shrink-0 rounded-md object-cover bg-muted" /> : <div className="w-16 h-16 shrink-0 rounded-md bg-muted" />}
        <div className="min-w-0 flex-1 space-y-1">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-tight line-clamp-2 hover:underline">
            {p.title}
          </a>
          {p.price ? (
            <p className="text-sm">
              <span className="font-semibold">{money(p.price, currency)}</span>
              {p.compareAt ? <span className="ml-1.5 text-xs text-muted-foreground line-through">{money(p.compareAt, currency)}</span> : null}
              {off > 0 ? <span className="ml-1.5 text-xs font-medium text-good">−{off}%</span> : null}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <Button asChild size="sm" variant="outline" className="h-9 sm:h-7 text-xs">
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open product
              </a>
            </Button>
            {p.image && matches === null ? (
              <Button size="sm" variant="outline" className="h-9 sm:h-7 text-xs" onClick={() => void onFind()} disabled={busy}>
                {busy ? <Spinner className="w-3.5 h-3.5 mr-1" /> : <Search className="w-3.5 h-3.5 mr-1" />}
                Find on AliExpress
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {matches !== null ? (
        matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">No look-alike listing on AliExpress.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {matches.map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="group flex gap-2 rounded-md border border-border p-1.5">
                {m.imageUrl ? <img src={m.imageUrl} alt="" loading="lazy" className="w-10 h-10 shrink-0 rounded object-cover bg-muted" /> : null}
                <span className="min-w-0">
                  <span className="block text-[11px] leading-tight line-clamp-2 group-hover:underline">{m.title}</span>
                  <span className="text-xs font-semibold">${m.price.toFixed(2)}</span>
                </span>
              </a>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

/** The store's id in AdSpy, adding it first when it isn't listed yet. */
function useEnsureStore(s: FoundStore, storeId?: Id<"stores">) {
  const ensure = useMutation(api.offerSearch.ensureStore);
  return async () => storeId ?? (await ensure({ host: s.host, name: s.advertisers[0], shopify: !!s.shopify, ...(s.storeCountry ? { country: s.storeCountry } : {}) }));
}

function TrackButton({ store: s, storeId, tracked }: { store: FoundStore; storeId?: Id<"stores">; tracked: boolean }) {
  const ensure = useEnsureStore(s, storeId);
  const toggle = useMutation(api.stores.toggleTrackStore);
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const r = await toggle({ storeId: await ensure() });
      toast.success(r.tracked ? `${s.host} is on your Watchlist (Stores).` : `${s.host} is off your Watchlist.`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't track the store"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" className={tracked ? "h-10 sm:h-8 border-primary/50 text-primary" : "h-10 sm:h-8"} onClick={() => void onClick()} disabled={busy}>
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : tracked ? <BookmarkCheck className="w-4 h-4 mr-1.5" /> : <Bookmark className="w-4 h-4 mr-1.5" />}
      {tracked ? "On Watchlist" : "Track store"}
    </Button>
  );
}

function CollectionButton({ store: s, storeId }: { store: FoundStore; storeId?: Id<"stores"> }) {
  const ensure = useEnsureStore(s, storeId);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  if (storeId) return <AddToCollection kind="store" refId={storeId} className="h-10 sm:h-8 px-3 text-sm" defaultOpen={opened} />;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-10 sm:h-8"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await ensure();
          setOpened(true);
        } catch (e) {
          toast.error(errorMessage(e, "Couldn't add the store"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <FolderPlus className="w-4 h-4 mr-1.5" />}
      Collection
    </Button>
  );
}
