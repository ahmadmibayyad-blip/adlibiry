import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Search, Sparkles, X, Play, Flame, Clock, Rocket, Link2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AdCard, { AdCardSkeleton } from "./_components/AdCard.tsx";
import AdDetailModal from "./_components/AdDetailModal.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { SATURATION_COUNTRIES } from "@/lib/countries.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import FilterNumberInput from "@/components/FilterNumberInput.tsx";
import { flag, compactNumber } from "@/lib/adFormat.ts";

type Ad = Doc<"ads">;

const platforms = ["All", "Facebook", "Instagram", "TikTok"];

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Winning score" },
  { value: "impressions", label: "Most impressions" },
  { value: "mostLiked", label: "Most likes" },
  { value: "comments", label: "Most comments" },
  { value: "shares", label: "Most shares" },
  { value: "copies", label: "Most ad copies" },
  { value: "highestSpend", label: "Highest spend" },
  { value: "longestRunning", label: "Longest running" },
  { value: "lastSeen", label: "Recently seen" },
];

const mediaOptions = [
  { value: "none", label: "Any" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "carousel", label: "Carousel" },
];

const publishedOptions = [
  { value: "none", label: "Any time" },
  { value: "1", label: "Last 24h" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const sourceOptions = [
  { value: "none", label: "Any" },
  { value: "adlibrary_api", label: "AdLibrary" },
  { value: "apify", label: "Meta (Apify)" },
  { value: "nexscope", label: "TikTok (Nexscope)" },
  { value: "extension", label: "Extension" },
  { value: "winninghunter", label: "WinningHunter" },
];

const genderOptions = [
  { value: "none", label: "Any" },
  { value: "All", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

const countryName = (code: string) => SATURATION_COUNTRIES.find((c) => c.code === code)?.name ?? code;
const num = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : undefined);

export default function AdSpyPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [platform, setPlatform] = useState<string>();
  const [country, setCountry] = useState<string>();
  const [niche, setNiche] = useState<string>();
  const [sort, setSort] = useState<string>();
  const [mediaType, setMediaType] = useState<string>();
  const [published, setPublished] = useState<string>();
  const [cta, setCta] = useState<string>();
  const [source, setSource] = useState<string>();
  const [gender, setGender] = useState<string>();
  const [activeOnly, setActiveOnly] = useState(false);
  const [hasLandingPage, setHasLandingPage] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [minComments, setMinComments] = useState("");
  const [minImpressions, setMinImpressions] = useState("");
  const [minAiScore, setMinAiScore] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const facets = useQuery(api.ads.getFacets, {});

  const minImpressionsN = num(minImpressions);
  const filters = {
    platform,
    country,
    niche,
    search: debouncedSearch || undefined,
    sort,
    mediaType,
    firstSeenWithinDays: published ? Number(published) : undefined,
    cta,
    source,
    gender,
    activeOnly: activeOnly || undefined,
    hasLandingPage: hasLandingPage || undefined,
    minCopies: scaling ? 3 : undefined,
    minDaysRunning: num(minDays),
    maxDaysRunning: num(maxDays),
    minLikes: num(minLikes),
    minComments: num(minComments),
    minImpressions: minImpressionsN !== undefined ? minImpressionsN * 1000 : undefined,
    minAiScore: num(minAiScore),
  };
  const activeCount = Object.entries(filters).filter(([k, v]) => k !== "search" && k !== "sort" && v !== undefined).length;

  const { results, status, loadMore } = usePaginatedQuery(api.ads.list, filters, { initialNumItems: 24 });

  const clearAll = () => {
    setPlatform(undefined); setCountry(undefined); setNiche(undefined); setMediaType(undefined);
    setPublished(undefined); setCta(undefined); setSource(undefined); setGender(undefined);
    setActiveOnly(false); setHasLandingPage(false); setScaling(false);
    setMinDays(""); setMaxDays(""); setMinLikes(""); setMinComments(""); setMinImpressions(""); setMinAiScore("");
  };

  const quick = [
    { label: "Active now", icon: Flame, on: activeOnly, toggle: () => setActiveOnly(!activeOnly) },
    { label: "Video ads", icon: Play, on: mediaType === "video", toggle: () => setMediaType(mediaType === "video" ? undefined : "video") },
    { label: "New this week", icon: Clock, on: published === "7", toggle: () => setPublished(published === "7" ? undefined : "7") },
    { label: "Scaling (3+ copies)", icon: Rocket, on: scaling, toggle: () => setScaling(!scaling) },
    { label: "Has store link", icon: Link2, on: hasLandingPage, toggle: () => setHasLandingPage(!hasLandingPage) },
  ];

  const countryOptions = [
    { value: "All", label: "All countries" },
    ...(facets?.countries ?? []).map((c) => ({ value: c.value, label: `${flag(c.value)} ${countryName(c.value)} (${c.n})` })),
  ];
  const nicheOptions = [{ value: "All", label: "All niches" }, ...(facets?.niches ?? []).map((n) => ({ value: n.value, label: `${n.value} (${n.n})` }))];
  const ctaOptions = [{ value: "none", label: "Any" }, ...(facets?.ctas ?? []).map((c) => ({ value: c.value, label: `${c.value} (${c.n})` }))];

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

      {/* Filter panel */}
      <div className="bg-card border border-border rounded-xl p-3 mb-5 space-y-3">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad text, advertiser, product or niche…"
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 h-10 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1 overflow-x-auto">
            {platforms.map((p) => {
              const on = p === "All" ? !platform : platform === p;
              return (
                <button
                  key={p}
                  onClick={() => setPlatform(p === "All" ? undefined : p)}
                  className={cn(
                    "px-3 h-8 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer",
                    on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              onClick={q.toggle}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 rounded-full text-xs border cursor-pointer transition-colors",
                q.on ? "bg-primary/15 border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <q.icon className="w-3.5 h-3.5" />
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Sort" value={sort ?? "newest"} onChange={(v) => setSort(v === "newest" ? undefined : v)} options={sortOptions} active={!!sort} />
          <FilterSelect label="Country" value={country ?? "All"} onChange={(v) => setCountry(v === "All" ? undefined : v)} options={countryOptions} active={!!country} />
          <FilterSelect label="Niche" value={niche ?? "All"} onChange={(v) => setNiche(v === "All" ? undefined : v)} options={nicheOptions} active={!!niche} />
          <FilterSelect label="Media" value={mediaType ?? "none"} onChange={(v) => setMediaType(v === "none" ? undefined : v)} options={mediaOptions} active={!!mediaType} />
          <FilterSelect label="First seen" value={published ?? "none"} onChange={(v) => setPublished(v === "none" ? undefined : v)} options={publishedOptions} active={!!published} />
          {ctaOptions.length > 1 && (
            <FilterSelect label="CTA" value={cta ?? "none"} onChange={(v) => setCta(v === "none" ? undefined : v)} options={ctaOptions} active={!!cta} />
          )}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn("flex items-center gap-1.5 h-8 px-3 rounded-full text-xs border cursor-pointer", showMore ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            More filters
          </button>
          {activeCount > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer h-8 px-2">
              <X className="w-3.5 h-3.5" />Clear ({activeCount})
            </button>
          )}
        </div>

        {showMore && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
            <FilterNumberInput label="Min days" value={minDays} onChange={setMinDays} placeholder="0" />
            <FilterNumberInput label="Max days" value={maxDays} onChange={setMaxDays} placeholder="∞" />
            <FilterNumberInput label="Min impressions (K)" value={minImpressions} onChange={setMinImpressions} placeholder="0" />
            <FilterNumberInput label="Min likes" value={minLikes} onChange={setMinLikes} placeholder="0" />
            <FilterNumberInput label="Min comments" value={minComments} onChange={setMinComments} placeholder="0" />
            <FilterNumberInput label="Min score" value={minAiScore} onChange={setMinAiScore} placeholder="0" />
            <FilterSelect label="Audience" value={gender ?? "none"} onChange={(v) => setGender(v === "none" ? undefined : v)} options={genderOptions} active={!!gender} />
            <FilterSelect label="Source" value={source ?? "none"} onChange={(v) => setSource(v === "none" ? undefined : v)} options={sourceOptions} active={!!source} />
          </div>
        )}
      </div>

      {/* Results */}
      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <AdCardSkeleton key={i} />)}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No ads match these filters</h3>
          <p className="text-sm text-muted-foreground mb-3">Try removing a filter.</p>
          {activeCount > 0 && <Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {results.map((ad) => (
              <AdCard key={ad._id} ad={ad} onClick={() => { setSelectedAd(ad); setModalOpen(true); }} />
            ))}
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={() => loadMore(24)} className="px-8">Load more ads</Button>
            </div>
          )}
          {status === "LoadingMore" && (
            <div className="flex justify-center mt-8 text-sm text-muted-foreground">Loading…</div>
          )}
        </>
      )}

      <AdDetailModal ad={selectedAd} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
