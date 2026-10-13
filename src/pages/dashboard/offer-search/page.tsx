import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Clock, ExternalLink, Layers, Radar, Search, ShoppingBag, Tags } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { OFFER_COUNTRIES, OFFER_IDS, OFFERS, type FoundStore, type OfferId } from "@/convex/lib/offerSearch.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Offer Search: pick an offer and a country, AdSpy searches Meta's Ad Library in that country's language
// (convex/offerSearch.ts) and shows the stores running the offer, grouped by store.

const COUNTRY_OPTIONS = Object.entries(OFFER_COUNTRIES).map(([code, c]) => ({ value: code, label: c.name }));
const libraryUrl = (country: string, s: FoundStore) =>
  s.pageId
    ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&view_all_page_id=${s.pageId}`
    : `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(s.host)}`;

export default function OfferSearchPage() {
  const start = useAction(api.offerSearch.start);
  const recent = useQuery(api.offerSearch.recent, {});
  const [params, setParams] = useSearchParams();
  const [offer, setOffer] = useState<OfferId | "custom">("bxgy");
  // Starts on the user's target country (onboarding / Settings) when Offer Search covers it, else Denmark.
  const mine = useQuery(api.onboarding.mine, {});
  const target = mine?.targetCountry;
  const [picked, setCountry] = useState<string | null>(null);
  const country = picked ?? (target && OFFER_COUNTRIES[target] ? target : "DK");
  const [extra, setExtra] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const id = params.get("id") as Id<"offerSearches"> | null;
  const search = useQuery(api.offerSearch.get, id ? { id } : "skip");

  // Open the latest search when none is chosen.
  useEffect(() => {
    if (!id && recent?.searches[0]) setParams({ id: recent.searches[0]._id }, { replace: true });
  }, [id, recent, setParams]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await start({ country, ...(offer === "custom" ? { custom } : { offer }), ...(extra.trim() ? { extra } : {}) });
      setParams({ id: r.id });
      if (r.cached) toast.success("Someone ran this search in the last hours: here are those results.");
    } catch (err) {
      toast.error(errorMessage(err, "The search couldn't start"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tags className="w-6 h-6 text-primary" /> Offer Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find the stores running an offer in a country right now. We search Meta's Ad Library in that country's language and group the active ads by store.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {OFFER_IDS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOffer(o)}
              className={cn(
                "rounded-full border px-3 py-1.5 min-h-10 sm:min-h-0 text-sm transition",
                offer === o ? "border-primary bg-primary/10 text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {OFFERS[o].label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOffer("custom")}
            className={cn(
              "rounded-full border px-3 py-1.5 min-h-10 sm:min-h-0 text-sm transition",
              offer === "custom" ? "border-primary bg-primary/10 text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            My own words
          </button>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <FilterSelect label="Country" value={country} onChange={setCountry} options={COUNTRY_OPTIONS} active />
          {offer === "custom" ? (
            <Input className="h-10 sm:h-8 w-60" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 3 for 2, in the country's language" />
          ) : null}
          <Input className="h-10 sm:h-8 w-56" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Product word (optional), e.g. hund" />
          <Button type="submit" size="sm" className="h-10 sm:h-8" disabled={busy || (offer === "custom" && !custom.trim())}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Search
          </Button>
          {recent ? <span className="text-xs text-muted-foreground">{Math.max(0, recent.limit - recent.used)} searches left today</span> : null}
        </form>
        {recent && recent.searches.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {recent.searches.map((s) => (
              <button
                key={s._id}
                type="button"
                onClick={() => setParams({ id: s._id })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 min-h-10 sm:min-h-0 text-xs transition",
                  id === s._id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {s.country} · {s.offer ? OFFERS[s.offer as OfferId]?.label : s.phrases[0]}
                {s.status === "done" ? ` · ${s.stores}` : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {search ? <Results search={search} /> : null}
    </div>
  );
}

type SearchView = NonNullable<FunctionReturnType<typeof api.offerSearch.get>>;

function Results({ search }: { search: SearchView }) {
  const head = (
    <p className="text-sm text-muted-foreground">
      {OFFER_COUNTRIES[search.country]?.name ?? search.country} · searched for {search.phrases.map((p) => `“${p}”`).join(" and ")}
    </p>
  );
  if (search.status === "running") {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
        <Spinner className="w-6 h-6 mx-auto" />
        <p className="font-medium">Searching Meta's Ad Library…</p>
        <p className="text-sm text-muted-foreground">This usually takes 1–3 minutes. You can leave this page; the results wait here.</p>
        {head}
      </div>
    );
  }
  if (search.status === "failed") {
    return (
      <div className="rounded-xl border border-border bg-card p-6 space-y-1">
        <p className="font-medium">{search.error ?? "The search didn't work."}</p>
        {head}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {search.stores.length} {search.stores.length === 1 ? "store" : "stores"} from {search.adsFound ?? 0} active ads
        </h2>
        {head}
      </div>
      {search.stores.length === 0 ? <p className="text-sm text-muted-foreground">No active ads link to a store for this search. Try another offer or drop the product word.</p> : null}
      <p className="text-xs text-muted-foreground">Ad counts are the ads this search found, not the store's total. Busiest stores first.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {search.stores.map((s) => (
          <StoreCard key={s.host} store={s} country={search.country} />
        ))}
      </div>
    </div>
  );
}

function StoreCard({ store: s, country }: { store: FoundStore; country: string }) {
  const storeUrl = `https://${s.host}${s.productPaths[0] ?? ""}`;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={`https://${s.host}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline break-all inline-block py-2.5 -my-2.5 sm:py-0 sm:my-0">
            {s.host}
          </a>
          <p className="text-xs text-muted-foreground truncate">{s.advertisers.join(" · ")}</p>
        </div>
        {s.shopify ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <ShoppingBag className="w-3 h-3" /> Shopify
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" /> {s.ads} {s.ads === 1 ? "ad" : "ads"}
          {s.copies > s.ads ? ` (${s.copies} versions)` : ""}
        </span>
        {s.oldestDays > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> oldest running {s.oldestDays} days
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
        <Button asChild size="sm" variant="outline" className="h-10 sm:h-8">
          <a href={libraryUrl(country, s)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" /> All its ads
          </a>
        </Button>
      </div>
    </div>
  );
}
