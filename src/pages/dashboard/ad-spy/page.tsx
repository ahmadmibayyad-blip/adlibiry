import { useEffect, useMemo, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Search, Sparkles, X } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AdCard, { AdCardSkeleton } from "./_components/AdCard.tsx";
import ImageSearchDialog from "../_components/ImageSearchDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { SATURATION_COUNTRIES } from "@/lib/countries.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import PlatformIcon from "@/components/PlatformIcon.tsx";
import { Chip, Check, SavedSearches } from "@/components/filters.tsx";
import { ANY, opt, range, readJson, writeJson } from "@/lib/filterUtils.ts";
import { flag, compactNumber } from "@/lib/adFormat.ts";

type Ad = Doc<"ads">;

// ── Filter model ────────────────────────────────────────────────────────────
// Everything the panel can set lives in one object, so a search can be saved
// and restored in one go. Range filters are stored as "min-max" strings
// ("1000-" = at least 1000).
type Filters = {
  platform?: string;
  niche?: string;
  firstSeen?: string; // days
  lastSeen?: string; // days
  runTime?: string; // range, days
  country?: string;
  language?: string;
  cta?: string;
  landing?: string; // "has"
  mediaType?: string;
  gender?: string;
  source?: string;
  impressions?: string; // range
  likes?: string; // range
  spend?: string; // range, USD
  score?: string; // range
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
const SPEND = [ANY, opt("0-1000", "Under $1K"), opt("1000-10000", "$1K–$10K"), opt("10000-50000", "$10K–$50K"), opt("50000-", "$50K+")];
const SCORE = [ANY, opt("40-", "40+"), opt("60-", "60+"), opt("80-", "80+")];
const MEDIA = [ANY, opt("video", "Video"), opt("image", "Image"), opt("carousel", "Carousel")];
const LANDING = [ANY, opt("has", "Has store link")];
const AUDIENCE = [ANY, opt("All", "All genders"), opt("Female", "Mostly women"), opt("Male", "Mostly men")];
// WinningHunter and CSV imports run in the background: their ads show under
// Any source, but they aren't listed as a choice.
const SOURCES = [
  ANY,
  opt("adlibrary_api", "AdLibrary"),
  opt("apify", "Meta (Apify)"),
  opt("nexscope", "TikTok (Nexscope)"),
  opt("extension", "Extension"),
];
const SORTS = [
  opt("added", "Recently added"),
  opt("newest", "Newest (first seen)"),
  opt("lastSeen", "Last seen"),
  opt("score", "Winning score"),
  opt("impressions", "Most impressions"),
  opt("mostLiked", "Most likes"),
  opt("comments", "Most comments"),
  opt("shares", "Most shares"),
  opt("copies", "Most ad copies"),
  opt("longestRunning", "Longest running"),
];

// Panel state → ads.list args.
function toQueryArgs(f: Filters, search: string) {
  const run = range(f.runTime);
  const imp = range(f.impressions);
  const likes = range(f.likes);
  const spend = range(f.spend);
  const score = range(f.score);
  const firstSeenDays = [f.firstSeen ? Number(f.firstSeen) : undefined, f.newAds ? 7 : undefined].filter((x): x is number => x !== undefined);
  return {
    platform: f.platform,
    niche: f.niche,
    country: f.country,
    language: f.language,
    cta: f.cta,
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
    minAiScore: score.min,
    minCopies: f.repeated ? 2 : undefined,
    activeOnly: f.active || undefined,
    hasLandingPage: f.landing === "has" || undefined,
  };
}

// ── Per-browser memory: viewed ads + saved searches ─────────────────────────
const VIEWED_KEY = "adspy.viewedAds";
const SAVED_KEY = "adspy.savedSearches";

const countryName = (code: string) => SATURATION_COUNTRIES.find((c) => c.code === code)?.name ?? code;

export default function AdSpyPage() {
  // ?source=…&sort=…&platform=… (e.g. from an admin import's "View" link) preset the filters.
  const [params] = useSearchParams();
  const [f, setF] = useState<Filters>(() => ({
    ...(params.get("source") ? { source: params.get("source")! } : {}),
    ...(params.get("sort") ? { sort: params.get("sort")! } : {}),
    ...(params.get("platform") ? { platform: params.get("platform")! } : {}),
  }));
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setAny = (key: keyof Filters) => (v: string) => set(key, (v === "any" ? undefined : v) as never);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const navigate = useNavigate();

  const [excludeViewed, setExcludeViewed] = useState(false);
  const [viewed, setViewed] = useState<string[]>(() => readJson<string[]>(VIEWED_KEY, []));
  const viewedSet = useMemo(() => new Set(viewed), [viewed]);

  const facets = useQuery(api.ads.getFacets, {});
  const args = toQueryArgs(f, debouncedSearch);
  const { results, status, loadMore } = usePaginatedQuery(api.ads.list, args, { initialNumItems: 24 });
  const shown = excludeViewed ? results.filter((a) => !viewedSet.has(a._id)) : results;

  // Some filters (country, CTA, spend, viewed) trim a page after it's read,
  // so keep reading until the grid has as many ads as asked for (24, +24 per
  // "Load more").
  const PAGE = 24;
  const filterKey = JSON.stringify(args) + excludeViewed;
  const [wanted, setWanted] = useState({ key: filterKey, n: PAGE });
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

  const activeCount = Object.entries(f).filter(([k, v]) => k !== "sort" && v !== undefined && v !== false).length;
  const clearAll = () => setF((prev) => ({ sort: prev.sort }));

  const openAd = (ad: Ad) => {
    navigate(`/dashboard/ads/${ad._id}`);
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
          <div className="flex gap-2 text-xs">
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

      <div className="bg-card border border-border rounded-xl p-3 mb-5 space-y-3">
        {/* Platform + search */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <Chip on={!f.platform} onClick={() => set("platform", undefined)}>All</Chip>
            {PLATFORMS.map((p) => (
              <Chip key={p} on={f.platform === p} onClick={() => set("platform", f.platform === p ? undefined : p)}>
                <PlatformIcon platform={p} />
                {p}
              </Chip>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad copy…"
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 h-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <ImageSearchDialog trigger="icon" />
        </div>

        {/* Niches */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1 shrink-0">Niche</span>
          <Chip on={!f.niche} onClick={() => set("niche", undefined)}>All</Chip>
          {niches.map((n) => (
            <Chip key={n.value} on={f.niche === n.value} onClick={() => set("niche", f.niche === n.value ? undefined : n.value)}>
              {n.value}
              <span className="opacity-60 tabular-nums">{compactNumber(n.n)}</span>
            </Chip>
          ))}
        </div>

        {/* Dates */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">First seen</span>
          {FIRST_SEEN.map((o) => (
            <Chip key={o.label} on={f.firstSeen === o.value} onClick={() => set("firstSeen", o.value)}>{o.label}</Chip>
          ))}
          <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
          <FilterSelect label="Last seen" value={f.lastSeen ?? "any"} onChange={setAny("lastSeen")} options={LAST_SEEN} active={!!f.lastSeen} />
          <FilterSelect label="Ad run time" value={f.runTime ?? "any"} onChange={setAny("runTime")} options={RUN_TIME} active={!!f.runTime} />
        </div>

        {/* Targeting + creative */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Country" value={f.country ?? "any"} onChange={setAny("country")} options={countryOptions} active={!!f.country} />
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
          <FilterSelect label="Impressions" value={f.impressions ?? "any"} onChange={setAny("impressions")} options={IMPRESSIONS} active={!!f.impressions} />
          <FilterSelect label="Engagement (likes)" value={f.likes ?? "any"} onChange={setAny("likes")} options={LIKES} active={!!f.likes} />
          <FilterSelect label="Ad spend (USD)" value={f.spend ?? "any"} onChange={setAny("spend")} options={SPEND} active={!!f.spend} />
          <FilterSelect label="Winning score" value={f.score ?? "any"} onChange={setAny("score")} options={SCORE} active={!!f.score} />
          <div className="flex flex-wrap items-center gap-3 ml-1">
            <Check label="New ads" hint="First seen in the last 7 days" checked={!!f.newAds} onChange={(v) => set("newAds", v || undefined)} />
            <Check label="Repeated ads" hint="The same creative runs as 2+ ad copies — a scaling signal" checked={!!f.repeated} onChange={(v) => set("repeated", v || undefined)} />
            <Check label="Active now" checked={!!f.active} onChange={(v) => set("active", v || undefined)} />
          </div>
        </div>

        {/* Sort + saved searches */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
          <FilterSelect label="Sort by" value={f.sort ?? "added"} onChange={(v) => set("sort", v === "added" ? undefined : v)} options={SORTS} active={!!f.sort} />
          {activeCount > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2">
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

      {/* Results */}
      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <AdCardSkeleton key={i} />)}
        </div>
      ) : shown.length === 0 && status !== "LoadingMore" ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No ads match these filters</h3>
          <p className="text-sm text-muted-foreground mb-3">Try removing a filter.</p>
          {activeCount > 0 && <Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {shown.map((ad) => (
              <AdCard key={ad._id} ad={ad} onClick={() => openAd(ad)} />
            ))}
          </div>
          {status === "LoadingMore" ? (
            <div className="flex justify-center mt-8 text-sm text-muted-foreground">Loading…</div>
          ) : status === "CanLoadMore" ? (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={showMoreAds} className="px-8">Load more ads</Button>
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
