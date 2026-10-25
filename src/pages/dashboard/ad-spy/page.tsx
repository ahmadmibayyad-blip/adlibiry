import { useEffect, useMemo, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { ChevronDown, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AdCard, { AdCardSkeleton } from "./_components/AdCard.tsx";
import ImageSearchDialog from "../_components/ImageSearchDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { useHistoryState } from "@/hooks/use-history-state.ts";
import { SATURATION_COUNTRIES } from "@/lib/countries.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import { cn } from "@/lib/utils.ts";
import PlatformIcon from "@/components/PlatformIcon.tsx";
import { Chip, Check, SavedSearches } from "@/components/filters.tsx";
import { ANY, opt, range, readJson, writeJson } from "@/lib/filterUtils.ts";
import { flag, compactNumber } from "@/lib/adFormat.ts";
import TrialLimitNotice from "../_components/TrialLimitNotice.tsx";
import { useMyNiches } from "@/hooks/use-my-niches.ts";
import MyNichesChip from "@/components/MyNichesChip.tsx";
import CpmSetting from "./_components/CpmSetting.tsx";
import { useCpm } from "@/hooks/use-cpm.ts";

type Ad = Doc<"ads">;

// ── Filter model ────────────────────────────────────────────────────────────
// Everything the panel can set lives in one object, so a search can be saved
// and restored in one go. Range filters are stored as "min-max" strings
// ("1000-" = at least 1000).
type Filters = {
  platform?: string;
  scaling?: boolean; // older saved searches; now stage "scaling"
  stage?: string; // convex/lib/adStage.ts AdStage
  niche?: string;
  firstSeen?: string; // days
  lastSeen?: string; // days
  runTime?: string; // range, days
  country?: string;
  language?: string;
  cta?: string;
  offer?: string; // lib/offerTags.ts OfferKind
  landing?: string; // "has"
  mediaType?: string;
  gender?: string;
  source?: string;
  impressions?: string; // range
  likes?: string; // range
  spend?: string; // range, USD (EU reach × CPM where there is EU reach: lib/euSpend.ts)
  reach?: string; // range, EU reach
  eu?: boolean; // only ads with EU reach
  score?: string; // range
  rank?: string; // max rank on the advertiser's page, e.g. "10" = top 10
  pageAds?: string; // min live ads the advertiser has
  newAds?: boolean;
  repeated?: boolean;
  active?: boolean;
  sort?: string;
};

const PLATFORMS = ["Facebook", "Instagram", "TikTok"];

const FIRST_SEEN = [
  { value: undefined, label: "All" },
  { value: "1", label: "Last 24h" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last year" },
];

const LAST_SEEN = [ANY, opt("1", "Last 24h"), opt("3", "Last 3 days"), opt("7", "Last 7 days"), opt("30", "Last 30 days")];
const RUN_TIME = [ANY, opt("1-7", "1–7 days"), opt("7-30", "7–30 days"), opt("30-90", "30–90 days"), opt("90-", "90+ days")];
const IMPRESSIONS = [ANY, opt("0-10000", "Under 10K"), opt("10000-100000", "10K–100K"), opt("100000-1000000", "100K–1M"), opt("1000000-", "1M+")];
const LIKES = [ANY, opt("100-", "100+"), opt("1000-", "1K+"), opt("10000-", "10K+"), opt("100000-", "100K+")];
const SPEND = [ANY, opt("0-100", "Under $100"), opt("100-1000", "$100–$1K"), opt("1000-10000", "$1K–$10K"), opt("10000-50000", "$10K–$50K"), opt("50000-", "$50K+")];
// Stage labels on the cards (convex/lib/adStage.ts).
const STAGE = [
  ANY,
  opt("scaling", "Scaling"),
  opt("winning", "Winning (7+ days, $100+ spend)"),
  opt("testing", "Testing (new or under 1K views)"),
];
const REACH = [ANY, opt("0-1000", "Under 1K"), opt("1000-10000", "1K–10K"), opt("10000-100000", "10K–100K"), opt("100000-1000000", "100K–1M"), opt("1000000-", "1M+")];
// Rank among the advertiser's live ads, and how many it runs (convex/lib/adRank.ts).
const RANK = [ANY, opt("1", "#1 on its page"), opt("3", "Top 3 on its page"), opt("10", "Top 10 on its page")];
const PAGE_ADS = [ANY, opt("5", "5+ live ads"), opt("10", "10+ live ads"), opt("30", "30+ live ads"), opt("80", "80+ live ads")];

// One-click views: each sets these filters and clears the rest (sort stays).
const PRESETS: { id: string; label: string; hint: string; filters: Filters }[] = [
  {
    id: "us-winners",
    label: "US winners",
    hint: "Winning US ads in the top 10 of an advertiser running 10+ ads",
    filters: { country: "US", stage: "winning", rank: "10", pageAds: "10" },
  },
  { id: "scaling", label: "Scaling now", hint: "Ads running 14+ days that are still getting budget", filters: { stage: "scaling" } },
  {
    id: "page-leaders",
    label: "#1 on their page",
    hint: "The best performing live ad of advertisers running 5+ ads",
    filters: { rank: "1", pageAds: "5" },
  },
  { id: "big-spenders", label: "Big spenders", hint: "Live ads with an estimated $50K+ spent", filters: { spend: "50000-", active: true } },
  { id: "fresh-tests", label: "Fresh tests", hint: "Ads first seen this week that are still testing", filters: { stage: "testing", firstSeen: "7" } },
];

const sameFilters = (a: Filters, b: Filters) => {
  const keys = (f: Filters) => Object.entries(f).filter(([k, v]) => k !== "sort" && v !== undefined && v !== false);
  const ka = keys(a);
  return ka.length === keys(b).length && ka.every(([k, v]) => b[k as keyof Filters] === v);
};

const SCORE = [ANY, opt("40-", "40+"), opt("60-", "60+"), opt("80-", "80+")];
const MEDIA = [ANY, opt("video", "Video"), opt("image", "Image"), opt("carousel", "Carousel")];
const LANDING = [ANY, opt("has", "Has store link")];
// The offer chips' kinds (convex/lib/offerTags.ts).
const OFFER = [
  ANY,
  opt("bxgy", "Buy X get Y"),
  opt("xfory", "X for Y (3 for 2)"),
  opt("percent", "% off"),
  opt("free_shipping", "Free shipping"),
  opt("free_gift", "Free gift"),
  opt("code", "Discount code"),
  opt("urgency", "Ends today / limited"),
];
const AUDIENCE = [ANY, opt("All", "All genders"), opt("Female", "Mostly women"), opt("Male", "Mostly men")];
// WinningHunter, PiPiSpy and CSV imports run in the background: their ads show under
// Any source, but they aren't listed as a choice.
const SOURCES = [
  ANY,
  opt("adlibrary_api", "AdLibrary"),
  opt("apify", "Meta"),
  opt("nexscope", "TikTok"),
  opt("extension", "Extension"),
];
const SORTS = [
  opt("added", "Recently added"),
  opt("newest", "Newest (first seen)"),
  opt("lastSeen", "Last seen"),
  opt("score", "Ad score"),
  opt("highestSpend", "Highest est. spend"),
  opt("impressions", "Most impressions"),
  opt("mostLiked", "Most likes"),
  opt("comments", "Most comments"),
  opt("shares", "Most shares"),
  opt("copies", "Most ad copies"),
  opt("longestRunning", "Longest running"),
  opt("topRank", "Rank on page (#1 first)"),
  opt("pageAds", "Advertiser's live ads"),
];

// Panel state → ads.list args.
function toQueryArgs(f: Filters, search: string, cpm: number) {
  const run = range(f.runTime);
  const imp = range(f.impressions);
  const likes = range(f.likes);
  const spend = range(f.spend);
  const reach = range(f.reach);
  const score = range(f.score);
  const firstSeenDays = [f.firstSeen ? Number(f.firstSeen) : undefined, f.newAds ? 7 : undefined].filter((x): x is number => x !== undefined);
  return {
    platform: f.platform,
    niche: f.niche,
    country: f.country,
    language: f.language,
    cta: f.cta,
    offer: f.offer,
    mediaType: f.mediaType,
    gender: f.gender,
    source: f.source,
    search: search || undefined,
    sort: f.sort ?? "added", // default: what was added to AdSpy Pro last comes first
    firstSeenWithinDays: firstSeenDays.length ? Math.min(...firstSeenDays) : undefined,
    lastSeenWithinDays: f.lastSeen ? Number(f.lastSeen) : undefined,
    minDaysRunning: run.min,
    maxDaysRunning: run.max,
    minImpressions: imp.min,
    maxImpressions: imp.max,
    minLikes: likes.min,
    maxLikes: likes.max,
    minSpend: spend.min,
    maxSpend: spend.max,
    // The server works spend out with the same CPM as the cards.
    // The stage labels use the same spend (lib/adStage.ts).
    cpm: spend.min !== undefined || spend.max !== undefined || f.stage ? cpm : undefined,
    minReach: reach.min,
    maxReach: reach.max,
    euOnly: f.eu || undefined,
    minAiScore: score.min,
    minCopies: f.repeated ? 2 : undefined,
    maxPageRank: f.rank ? Number(f.rank) : undefined,
    minPageAds: f.pageAds ? Number(f.pageAds) : undefined,
    activeOnly: f.active || undefined,
    scalingOnly: (f.scaling && !f.stage) || undefined,
    stage: f.stage,
    hasLandingPage: f.landing === "has" || undefined,
  };
}

// ── Per-browser memory: viewed ads + saved searches ─────────────────────────
const VIEWED_KEY = "adspy.viewedAds";
const SAVED_KEY = "adspy.savedSearches";

const countryName = (code: string) => SATURATION_COUNTRIES.find((c) => c.code === code)?.name ?? code;

export default function AdSpyPage() {
  // ?source=…&sort=…&platform=…&niche=…&country=…&firstSeen=… (e.g. from an admin import's "View" link) preset the filters.
  const [params] = useSearchParams();
  // Filters, search and how many ads are loaded come back on Back from an ad (use-history-state.ts).
  const [f, setF] = useHistoryState<Filters>("filters", () => ({
    ...(params.get("source") ? { source: params.get("source")! } : {}),
    ...(params.get("sort") ? { sort: params.get("sort")! } : {}),
    ...(params.get("platform") ? { platform: params.get("platform")! } : {}),
    // From a "new sellers entered <niche> in <country>" alert.
    ...(params.get("niche") ? { niche: params.get("niche")! } : {}),
    ...(params.get("country") ? { country: params.get("country")! } : {}),
    ...(params.get("firstSeen") ? { firstSeen: params.get("firstSeen")! } : {}),
  }));
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setAny = (key: keyof Filters) => (v: string) => set(key, (v === "any" ? undefined : v) as never);

  // ?q=… (Offer Search's "In Ad Spy") starts with that search.
  const [search, setSearch] = useHistoryState("search", () => params.get("q") ?? "");
  const [debouncedSearch] = useDebounce(search, 300);

  const [excludeViewed, setExcludeViewed] = useHistoryState("excludeViewed", false);
  const [viewed, setViewed] = useState<string[]>(() => readJson<string[]>(VIEWED_KEY, []));
  const viewedSet = useMemo(() => new Set(viewed), [viewed]);

  const facets = useQuery(api.ads.getFacets, {});
  const { niches: myNiches } = useMyNiches();
  const [useMine, setUseMine] = useHistoryState("useMine", true);
  const nichesOn = useMine && !f.niche && myNiches.length > 0;
  const [cpm] = useCpm();
  const args = { ...toQueryArgs(f, debouncedSearch, cpm), ...(nichesOn ? { niches: myNiches } : {}) };
  const { results, status, loadMore } = usePaginatedQuery(api.ads.list, args, { initialNumItems: 24 });
  const shown = excludeViewed ? results.filter((a) => !viewedSet.has(a._id)) : results;

  // Some filters (country, CTA, spend, viewed) trim a page after it's read,
  // so keep reading until the grid has as many ads as asked for (24, +24 per
  // "Load more").
  const PAGE = 24;
  const filterKey = JSON.stringify(args) + excludeViewed;
  const [wanted, setWanted] = useHistoryState("wanted", { key: filterKey, n: PAGE });
  const target = wanted.key === filterKey ? wanted.n : PAGE;
  const topUps = useRef({ key: "", target: 0, n: 0 });
  useEffect(() => {
    if (topUps.current.key !== filterKey || topUps.current.target !== target) topUps.current = { key: filterKey, target, n: 0 };
    if (status === "CanLoadMore" && shown.length < target && topUps.current.n < 15) {
      topUps.current.n++;
      loadMore(48);
    }
  }, [status, shown.length, filterKey, target, loadMore]);
  const showMoreAds = () => setWanted({ key: filterKey, n: Math.max(target, shown.length) + PAGE });

  // "My niches" is on by default, so it counts as a filter too.
  const activeCount = Object.entries(f).filter(([k, v]) => k !== "sort" && v !== undefined && v !== false).length + (nichesOn ? 1 : 0);
  // Filters set inside "Advanced filters" (everything but platform and the four visible ones).
  const advancedCount = Object.entries(f).filter(
    ([k, v]) => !["sort", "platform", "country", "niche", "runTime", "spend", "scaling", "stage"].includes(k) && v !== undefined && v !== false,
  ).length;
  const [showAdvanced, setShowAdvanced] = useHistoryState("advanced", advancedCount > 0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const preset = PRESETS.find((p) => sameFilters(f, p.filters));
  const clearAll = () => {
    setF((prev) => ({ sort: prev.sort }));
    setUseMine(false);
  };

  // The card is a link to the ad page; this only remembers it as viewed.
  const markViewed = (ad: Ad) => {
    if (!viewedSet.has(ad._id)) {
      const next = [ad._id, ...viewed].slice(0, 3000);
      setViewed(next);
      writeJson(VIEWED_KEY, next);
    }
  };

  const countryOptions = [
    opt("any", "All countries"),
    ...(facets?.countries ?? []).map((c) => opt(c.value, `${flag(c.value)} ${countryName(c.value)} (${compactNumber(c.n)})`)),
  ];
  const languageOptions = [ANY, ...(facets?.languages ?? []).map((l) => opt(l.value, `${l.value} (${compactNumber(l.n)})`))];
  const ctaOptions = [ANY, ...(facets?.ctas ?? []).map((c) => opt(c.value, `${c.value} (${compactNumber(c.n)})`))];
  const niches = facets?.niches ?? [];

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header + stats */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Ad Spy</h1>
          <p className="text-sm text-muted-foreground">Find winning ads on Facebook, Instagram and TikTok.</p>
        </div>
        {facets && (
          <div className="hidden sm:flex gap-2 text-xs">
            {[
              { label: "Ads", value: facets.total },
              { label: "Active", value: facets.activeCount },
              { label: "Videos", value: facets.videoCount },
              { label: "Countries", value: facets.countries.length },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-lg px-3 py-1.5 text-center">
                <div className="font-bold text-sm tabular-nums">{compactNumber(s.value)}</div>
                <div className="text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <TrialLimitNotice />

      <div className="bg-card border border-border rounded-xl p-3 mb-5 space-y-3">
        {/* Platform + search */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
            <Chip on={!f.platform} onClick={() => set("platform", undefined)}>All</Chip>
            {PLATFORMS.map((p) => (
              <Chip key={p} on={f.platform === p} onClick={() => set("platform", f.platform === p ? undefined : p)}>
                <PlatformIcon platform={p} />
                {/* Icon only on narrow phones so all four fit without clipping. */}
                <span className="sr-only min-[400px]:not-sr-only">{p}</span>
              </Chip>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              name="search"
              aria-label="Search ad copy"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad copy…"
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 h-10 sm:h-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <ImageSearchDialog trigger="icon" />
        </div>

        {/* Phones: the filters fold behind one button so the first screen shows results. */}
        <button
          type="button"
          onClick={() => setFiltersOpen(!filtersOpen)}
          aria-expanded={filtersOpen}
          aria-controls="adspy-filters"
          className="sm:hidden w-full flex items-center justify-center gap-2 h-11 rounded-lg border border-border text-sm font-medium cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" />
          {filtersOpen ? "Hide filters" : "Filters"}
          {activeCount > 0 && <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">{activeCount}</span>}
          <ChevronDown className={cn("w-4 h-4 transition-transform", filtersOpen && "rotate-180")} />
        </button>
        <div id="adspy-filters" className={cn("space-y-3", !filtersOpen && "hidden sm:block")}>
        {/* The four most-used filters stay visible; the rest fold away. Quick view sets a ready-made filter set. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Quick view"
            value={preset?.id ?? "none"}
            onChange={(id) => setF((prev) => ({ sort: prev.sort, ...PRESETS.find((p) => p.id === id)?.filters }))}
            options={[opt("none", "None"), ...PRESETS.map((p) => opt(p.id, p.label))]}
            active={!!preset}
          />
          <FilterSelect label="Country" value={f.country ?? "any"} onChange={setAny("country")} options={countryOptions} active={!!f.country} />
          <FilterSelect
            label="Category"
            value={f.niche ?? "all"}
            onChange={(v) => set("niche", v === "all" ? undefined : v)}
            options={[{ value: "all", label: "All" }, ...niches.map((n) => ({ value: n.value, label: `${n.value} (${compactNumber(n.n)})` }))]}
            active={!!f.niche}
          />
          <FilterSelect label="Offer" value={f.offer ?? "any"} onChange={setAny("offer")} options={OFFER} active={!!f.offer} />
          <FilterSelect label="Ad run time" value={f.runTime ?? "any"} onChange={setAny("runTime")} options={RUN_TIME} active={!!f.runTime} />
          <FilterSelect label="Ad spend (USD)" value={f.spend ?? "any"} onChange={setAny("spend")} options={SPEND} active={!!f.spend} />
          <CpmSetting />
          <FilterSelect
            label="Ad stage"
            value={f.stage ?? (f.scaling ? "scaling" : "any")}
            onChange={(v) => setF((prev) => ({ ...prev, scaling: undefined, stage: v === "any" ? undefined : v }))}
            options={STAGE}
            active={!!(f.stage || f.scaling)}
          />
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1 h-10 sm:h-8 px-2.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Advanced filters{advancedCount > 0 ? ` (${advancedCount})` : ""}
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showAdvanced && "rotate-180")} />
          </button>
        </div>
        {preset && <p className="text-xs text-muted-foreground -mt-1">{preset.label}: {preset.hint}.</p>}

        {showAdvanced && (
        <>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="First seen"
            value={f.firstSeen ?? "all"}
            onChange={(v) => set("firstSeen", v === "all" ? undefined : v)}
            options={FIRST_SEEN.map((o) => ({ value: o.value ?? "all", label: o.label }))}
            active={f.firstSeen !== undefined}
          />
          <FilterSelect label="Last seen" value={f.lastSeen ?? "any"} onChange={setAny("lastSeen")} options={LAST_SEEN} active={!!f.lastSeen} />
        </div>

        {/* Targeting + creative */}
        <div className="flex flex-wrap items-center gap-2">
          {languageOptions.length > 1 && (
            <FilterSelect label="Language" value={f.language ?? "any"} onChange={setAny("language")} options={languageOptions} active={!!f.language} />
          )}
          {ctaOptions.length > 1 && <FilterSelect label="CTA button" value={f.cta ?? "any"} onChange={setAny("cta")} options={ctaOptions} active={!!f.cta} />}
          <FilterSelect label="Landing page" value={f.landing ?? "any"} onChange={setAny("landing")} options={LANDING} active={!!f.landing} />
          <FilterSelect label="Format" value={f.mediaType ?? "any"} onChange={setAny("mediaType")} options={MEDIA} active={!!f.mediaType} />
          <FilterSelect label="Audience" value={f.gender ?? "any"} onChange={setAny("gender")} options={AUDIENCE} active={!!f.gender} />
          <FilterSelect label="Source" value={f.source ?? "any"} onChange={setAny("source")} options={SOURCES} active={!!f.source} />
        </div>

        {/* Performance */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="EU reach" value={f.reach ?? "any"} onChange={setAny("reach")} options={REACH} active={!!f.reach} />
          <FilterSelect label="Impressions" value={f.impressions ?? "any"} onChange={setAny("impressions")} options={IMPRESSIONS} active={!!f.impressions} />
          <FilterSelect label="Engagement (likes)" value={f.likes ?? "any"} onChange={setAny("likes")} options={LIKES} active={!!f.likes} />
          <FilterSelect label="Ad score" value={f.score ?? "any"} onChange={setAny("score")} options={SCORE} active={!!f.score} />
          <FilterSelect label="Rank on page" value={f.rank ?? "any"} onChange={setAny("rank")} options={RANK} active={!!f.rank} />
          <FilterSelect label="Advertiser's live ads" value={f.pageAds ?? "any"} onChange={setAny("pageAds")} options={PAGE_ADS} active={!!f.pageAds} />
          <div className="flex flex-wrap items-center gap-3 ml-1">
            <Check label="New ads" hint="First seen in the last 7 days" checked={!!f.newAds} onChange={(v) => set("newAds", v || undefined)} />
            <Check label="Repeated ads" hint="The same creative runs as 2+ ad copies — a scaling signal" checked={!!f.repeated} onChange={(v) => set("repeated", v || undefined)} />
            <Check label="Active now" checked={!!f.active} onChange={(v) => set("active", v || undefined)} />
            <Check label="EU ads only" hint="Ads Meta publishes EU reach for, so their spend is EU reach × your CPM" checked={!!f.eu} onChange={(v) => set("eu", v || undefined)} />
          </div>
        </div>
        </>
        )}

        {/* Sort + saved searches */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
          <FilterSelect label="Sort by" value={f.sort ?? "added"} onChange={(v) => set("sort", v === "added" ? undefined : v)} options={SORTS} active={!!f.sort} />
          <MyNichesChip niches={myNiches} on={nichesOn} onToggle={() => setUseMine(!useMine)} />
          {activeCount > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-10 sm:h-8 px-2">
              <X className="w-3.5 h-3.5" />Clear filters ({activeCount})
            </button>
          )}
          <div className="flex-1" />
          <Check label="Exclude viewed ads" hint="Hide ads you've already opened in this browser" checked={excludeViewed} onChange={setExcludeViewed} />
          <SavedSearches
            storageKey={SAVED_KEY}
            filters={f}
            search={search}
            onApply={(filters, q) => {
              setF(filters);
              setSearch(q);
            }}
          />
        </div>
        </div>
      </div>

      {/* Results */}
      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <AdCardSkeleton key={i} />)}
        </div>
      ) : shown.length === 0 && status !== "LoadingMore" ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No ads match these filters</h3>
          <p className="text-sm text-muted-foreground mb-3">
            {nichesOn ? "Only ads in your categories are shown." : "Try removing a filter."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {nichesOn && (
              <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => setUseMine(false)}>
                Show all categories
              </Button>
            )}
            {activeCount > (nichesOn ? 1 : 0) && (
              <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={clearAll}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {shown.map((ad) => (
              <AdCard key={ad._id} ad={ad} href={`/dashboard/ads/${ad._id}`} onClick={() => markViewed(ad)} />
            ))}
          </div>
          {status === "LoadingMore" ? (
            <div className="flex justify-center mt-8 text-sm text-muted-foreground">Loading…</div>
          ) : status === "CanLoadMore" ? (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={showMoreAds} className="h-10 px-8">Load more ads</Button>
            </div>
          ) : (
            <p className="text-center mt-8 text-xs text-muted-foreground">
              Showing all {shown.length} matching ad{shown.length === 1 ? "" : "s"}.
            </p>
          )}
        </>
      )}

    </div>
  );
}
