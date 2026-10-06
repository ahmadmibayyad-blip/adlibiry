import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Store, Search, Sparkles, TrendingUp, Bookmark, Scale, Info, X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import StoreCard, { StoreCardSkeleton } from "./_components/StoreCard.tsx";
import StoreDetailModal from "./_components/StoreDetailModal.tsx";
import StoreCompareModal from "./_components/StoreCompareModal.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { toast } from "sonner";
import { Authenticated, Unauthenticated } from "convex/react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import FilterNumberInput from "@/components/FilterNumberInput.tsx";
import FilterTogglePill from "@/components/FilterTogglePill.tsx";
import { SATURATION_COUNTRIES } from "@/lib/countries.ts";
import { storeImage } from "@/lib/storeImage.ts";
import TrialLimitNotice from "../_components/TrialLimitNotice.tsx";
import { storeRevenueLabel } from "@/lib/estimateFormat.ts";

type StoreDoc = Doc<"stores">;

const countryOptions = [
  { value: "All", label: "All countries" },
  ...SATURATION_COUNTRIES.map((c) => ({ value: c.code, label: c.code })),
];

export default function StoreTrackerPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [niche, setNiche] = useState<string | undefined>(undefined);
  const [minRevenue, setMinRevenue] = useState("");
  const [minTraffic, setMinTraffic] = useState("");
  const [minActiveAds, setMinActiveAds] = useState("");
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [highTrafficOnly, setHighTrafficOnly] = useState(false);
  const [selectedStore, setSelectedStore] = useState<StoreDoc | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<Array<StoreDoc["_id"]>>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showWatchlist, setShowWatchlist] = useState(false);

  // Alerts link to /dashboard/stores?store=<id>: open that store's popup.
  const [params, setParams] = useSearchParams();
  const linkedId = /^[a-z0-9]{20,40}$/.test(params.get("store") ?? "") ? params.get("store") : null;
  const linkedStore = useQuery(api.stores.getById, linkedId ? { id: linkedId as Id<"stores"> } : "skip");
  const closeLinked = () =>
    setParams(
      (p) => {
        p.delete("store");
        return p;
      },
      { replace: true },
    );

  const niches = useQuery(api.stores.getNiches, {});
  const recentlySpotted = useQuery(api.stores.getRecentlySpotted, {});
  const newlyDiscovered = useQuery(api.stores.getNewlyDiscovered, {});
  const trackedStores = useQuery(api.stores.getTrackedStores, {});
  const seedStores = useMutation(api.stores.seedStores);
  const isAdmin = useQuery(api.users.isAdmin, {});

  const parsedMinRevenue = minRevenue ? Number(minRevenue) * 1000 : undefined;
  const parsedMinTraffic = minTraffic ? Number(minTraffic) * 1000 : undefined;
  const parsedMinActiveAds = minActiveAds ? Number(minActiveAds) : undefined;
  const activeFilterCount = [
    parsedMinRevenue,
    parsedMinTraffic,
    parsedMinActiveAds,
    country,
    highTrafficOnly ? true : undefined,
  ].filter((v) => v !== undefined && !(typeof v === "number" && Number.isNaN(v))).length;

  const { results, status, loadMore } = usePaginatedQuery(
    api.stores.list,
    {
      search: debouncedSearch || undefined,
      niche,
      minRevenue: parsedMinRevenue,
      minTraffic: parsedMinTraffic,
      minActiveAds: parsedMinActiveAds,
      country,
      highTrafficOnly: highTrafficOnly || undefined,
    },
    { initialNumItems: 12 }
  );

  const handleSeed = async () => {
    await seedStores();
    toast.success("Store data loaded!");
  };

  const handleOpenStore = (store: StoreDoc) => {
    setSelectedStore(store);
    setModalOpen(true);
  };

  const handleClearFilters = () => {
    setMinRevenue("");
    setMinTraffic("");
    setMinActiveAds("");
    setCountry(undefined);
    setHighTrafficOnly(false);
  };

  const toggleCompare = (id: StoreDoc["_id"]) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : prev.length < 4 ? [...prev, id] : prev
    );
    if (compareIds.length >= 4 && !compareIds.includes(id)) {
      toast.error("You can compare up to 4 stores at a time");
    }
  };

  const displayedStores = showWatchlist ? trackedStores?.filter(Boolean) as StoreDoc[] | undefined : results;

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Store className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Store Tracker</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Spy on Shopify stores — see their best sellers, estimated revenue, traffic, and ad activity before you compete with them.
        </p>
      </motion.div>
      <TrialLimitNotice />

      {/* Stores added by product discovery (Shopify stores running Facebook ads) */}
      {!showWatchlist && newlyDiscovered && newlyDiscovered.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Newly discovered</h2>
            <span className="text-xs text-muted-foreground">Shopify stores selling products we found running Facebook ads</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {newlyDiscovered.map((store) => (
              <button
                key={store._id}
                onClick={() => handleOpenStore(store)}
                className="shrink-0 w-56 bg-card border border-border rounded-xl p-3 flex items-center gap-3 hover:border-primary/40 transition-all cursor-pointer text-left"
              >
                <img src={storeImage(store)} alt={store.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-snug line-clamp-1">{store.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {store.bestSellers.length} best-seller{store.bestSellers.length === 1 ? "" : "s"}
                    {store.activeAdsCount > 0 ? ` · ${store.activeAdsCount} ads` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recently spotted high-traffic feed */}
      {!showWatchlist && recentlySpotted && recentlySpotted.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <h2 className="font-semibold text-sm">Recently Spotted High-Traffic Stores</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentlySpotted.map((store) => (
              <button
                key={store._id}
                onClick={() => handleOpenStore(store)}
                className="shrink-0 w-56 bg-card border border-border rounded-xl p-3 flex items-center gap-3 hover:border-primary/40 transition-all cursor-pointer text-left"
              >
                <img src={storeImage(store)} alt={store.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-snug line-clamp-1">{store.name}</div>
                  {storeRevenueLabel(store) && <div className="text-xs text-muted-foreground">{storeRevenueLabel(store)}</div>}
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Search + actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex flex-col sm:flex-row gap-3 mb-3"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any Shopify store by name or URL..."
            disabled={showWatchlist}
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>
        <Authenticated>
          <Button
            variant={showWatchlist ? "default" : "secondary"}
            onClick={() => setShowWatchlist((s) => !s)}
            className="shrink-0"
          >
            <Bookmark className="w-4 h-4 mr-2" />
            Watchlist {trackedStores && trackedStores.length > 0 ? `(${trackedStores.length})` : ""}
          </Button>
        </Authenticated>
        {compareIds.length > 0 && (
          <Button variant="secondary" onClick={() => setCompareOpen(true)} className="shrink-0">
            <Scale className="w-4 h-4 mr-2" />
            Compare ({compareIds.length})
          </Button>
        )}
      </motion.div>

      {/* Advanced filter bar — dense row of dropdowns/inputs, always visible */}
      {!showWatchlist && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border"
        >
          <FilterNumberInput label="Min revenue $K/mo" value={minRevenue} onChange={setMinRevenue} placeholder="0" />
          <FilterNumberInput label="Min traffic K/mo" value={minTraffic} onChange={setMinTraffic} placeholder="0" />
          <FilterNumberInput label="Min active ads" value={minActiveAds} onChange={setMinActiveAds} placeholder="0" />
          <FilterSelect
            label="Country"
            value={country ?? "All"}
            onChange={(v) => setCountry(v === "All" ? undefined : v)}
            options={countryOptions}
            active={!!country}
          />
          <FilterTogglePill
            label="High-traffic only"
            active={highTrafficOnly}
            onToggle={() => setHighTrafficOnly((v) => !v)}
          />
          {activeFilterCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2"
            >
              <X className="w-3.5 h-3.5" />
              Clear ({activeFilterCount})
            </button>
          )}
        </motion.div>
      )}

      {!showWatchlist && niches && niches.length > 0 && (
        <div className="mb-6">
          <FilterSelect
            label="Niche"
            value={niche ?? "all"}
            onChange={(v) => setNiche(v === "all" ? undefined : v)}
            active={!!niche}
            options={[{ value: "all", label: "All niches" }, ...niches.map((n) => ({ value: n, label: n }))]}
          />
        </div>
      )}

      {showWatchlist ? (
        <Unauthenticated>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
              <EmptyTitle>Sign in to view your watchlist</EmptyTitle>
              <EmptyDescription>Track stores to get notified when they launch new products or ads.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Unauthenticated>
      ) : null}

      {showWatchlist && displayedStores === undefined ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <StoreCardSkeleton key={i} />
          ))}
        </div>
      ) : showWatchlist && displayedStores && displayedStores.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Bookmark /></EmptyMedia>
            <EmptyTitle>No tracked stores yet</EmptyTitle>
            <EmptyDescription>Track stores you want to keep an eye on and they'll show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : showWatchlist && displayedStores ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {displayedStores.map((store, i) => (
            <motion.div
              key={store._id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: (i % 8) * 0.04 }}
            >
              <StoreCard store={store} onClick={() => handleOpenStore(store)} />
            </motion.div>
          ))}
        </div>
      ) : status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <StoreCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Store className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No stores found</h3>
          <p className="text-sm text-muted-foreground mb-4">Try a different search term or filter.</p>
          {/* Demo data — admins only */}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={handleSeed} className="text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Load Sample Store Data
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((store, i) => (
              <motion.div
                key={store._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: (i % 8) * 0.04 }}
              >
                <StoreCard
                  store={store}
                  onClick={() => handleOpenStore(store)}
                  compareSelected={compareIds.includes(store._id)}
                  onToggleCompare={() => toggleCompare(store._id)}
                />
              </motion.div>
            ))}
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={() => loadMore(12)} className="px-8">
                Load more stores
              </Button>
            </div>
          )}
        </>
      )}

      {!showWatchlist && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 mt-6">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Revenue and traffic figures shown are honest ranged estimates from public storefront signals — never fabricated precise numbers.
        </p>
      )}

      <StoreDetailModal
        store={linkedStore ?? selectedStore}
        open={!!linkedStore || modalOpen}
        onOpenChange={(open) => {
          if (!open && linkedStore) closeLinked();
          setModalOpen(open);
        }}
      />
      <StoreCompareModal
        storeIds={compareIds}
        open={compareOpen}
        onOpenChange={setCompareOpen}
        onRemove={(id) => setCompareIds((prev) => prev.filter((c) => c !== id))}
      />
    </div>
  );
}
