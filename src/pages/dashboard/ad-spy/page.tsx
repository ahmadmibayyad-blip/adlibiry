import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { Search, Filter, Sparkles, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AdCard, { AdCardSkeleton } from "./_components/AdCard.tsx";
import AdDetailModal from "./_components/AdDetailModal.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { SATURATION_COUNTRIES } from "@/lib/countries.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import FilterNumberInput from "@/components/FilterNumberInput.tsx";

type Ad = Doc<"ads">;

const platforms = ["All", "Facebook", "Instagram", "TikTok", "Amazon"];
const countryOptions = [
  { value: "All", label: "All countries" },
  ...SATURATION_COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
];

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "mostLiked", label: "Most liked" },
  { value: "highestSpend", label: "Highest spend" },
  { value: "longestRunning", label: "Longest running" },
];

const sourceOptions = [
  { value: "none", label: "Any source" },
  { value: "meta_ad_library", label: "Live-synced (Meta)" },
  { value: "adlibrary_api", label: "Live-synced (AdLibrary)" },
  { value: "curated", label: "Curated example" },
];

const genderOptions = [
  { value: "none", label: "Any gender" },
  { value: "All", label: "All" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
];

export default function AdSpyPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [niche, setNiche] = useState<string | undefined>(undefined);
  const [minDaysRunning, setMinDaysRunning] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [minAiScore, setMinAiScore] = useState("");
  const [source, setSource] = useState<string | undefined>(undefined);
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const niches = useQuery(api.ads.getNiches, {});

  const parsedMinDaysRunning = minDaysRunning ? Number(minDaysRunning) : undefined;
  const parsedMinLikes = minLikes ? Number(minLikes) : undefined;
  const parsedMinSpend = minSpend ? Number(minSpend) * 1000 : undefined;
  const parsedMinAiScore = minAiScore ? Number(minAiScore) : undefined;
  const activeFilterCount = [
    parsedMinDaysRunning,
    parsedMinLikes,
    parsedMinSpend,
    parsedMinAiScore,
    source,
    gender,
    sort,
  ].filter((v) => v !== undefined && !(typeof v === "number" && Number.isNaN(v))).length;

  const { results, status, loadMore } = usePaginatedQuery(
    api.ads.list,
    {
      platform,
      country,
      niche,
      search: debouncedSearch || undefined,
      minDaysRunning: parsedMinDaysRunning,
      minLikes: parsedMinLikes,
      minSpend: parsedMinSpend,
      minAiScore: parsedMinAiScore,
      source,
      gender,
      sort,
    },
    { initialNumItems: 12 }
  );

  const handleOpenAd = (ad: Ad) => {
    setSelectedAd(ad);
    setModalOpen(true);
  };

  const handleClearFilters = () => {
    setMinDaysRunning("");
    setMinLikes("");
    setMinSpend("");
    setMinAiScore("");
    setSource(undefined);
    setGender(undefined);
    setSort(undefined);
  };

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Search className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Ad Spy</h1>
          <div className="flex items-center gap-1 bg-green-400/10 text-green-400 text-xs px-2 py-0.5 rounded-full border border-green-400/20">
            <ShieldCheck className="w-3 h-3" />
            Synced from AdLibrary.com
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Search real running ads across Facebook, Instagram, TikTok, and Amazon. Spend figures are honest ranged estimates, never fabricated precision.
        </p>
      </motion.div>

      {/* Search bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="mb-3"
      >
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by advertiser, headline, or niche..."
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
      </motion.div>

      {/* Platform / Country / Niche pills */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex flex-wrap items-center gap-3 mb-3"
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <Filter className="w-3.5 h-3.5" />
          Platform
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {platforms.map((p) => {
            const isActive = p === "All" ? !platform : platform === p;
            return (
              <button
                key={p}
                onClick={() => setPlatform(p === "All" ? undefined : p)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

        <FilterSelect
          label="Country"
          value={country ?? "All"}
          onChange={(v) => setCountry(v === "All" ? undefined : v)}
          options={countryOptions}
          active={!!country}
        />

        {niches && niches.length > 0 && (
          <>
            <div className="w-px h-5 bg-border mx-1 hidden sm:block" />
            <select
              value={niche ?? ""}
              onChange={(e) => setNiche(e.target.value || undefined)}
              className="bg-card border border-border rounded-full px-3 py-1.5 text-xs text-muted-foreground focus:outline-none cursor-pointer"
            >
              <option value="">All niches</option>
              {niches.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </>
        )}
      </motion.div>

      {/* Advanced filter bar — dense row of dropdowns/inputs, always visible */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border"
      >
        <FilterSelect
          label="Sort by"
          value={sort ?? "newest"}
          onChange={(v) => setSort(v === "newest" ? undefined : v)}
          options={sortOptions}
          active={!!sort}
        />
        <FilterNumberInput
          label="Days running"
          value={minDaysRunning}
          onChange={setMinDaysRunning}
          placeholder="0"
        />
        <FilterNumberInput
          label="Min likes"
          value={minLikes}
          onChange={setMinLikes}
          placeholder="0"
        />
        <FilterNumberInput
          label="Min spend $K/mo"
          value={minSpend}
          onChange={setMinSpend}
          placeholder="0"
        />
        <FilterNumberInput
          label="Min AI score"
          value={minAiScore}
          onChange={setMinAiScore}
          placeholder="0"
        />
        <FilterSelect
          label="Source"
          value={source ?? "none"}
          onChange={(v) => setSource(v === "none" ? undefined : v)}
          options={sourceOptions}
          active={!!source}
        />
        <FilterSelect
          label="Gender"
          value={gender ?? "none"}
          onChange={(v) => setGender(v === "none" ? undefined : v)}
          options={genderOptions}
          active={!!gender}
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

      {/* Grid */}
      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <AdCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Sparkles className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No ads found</h3>
          <p className="text-sm text-muted-foreground">Try a different search or filter combination.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((ad, i) => (
              <motion.div
                key={ad._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: (i % 8) * 0.04 }}
              >
                <AdCard ad={ad} onClick={() => handleOpenAd(ad)} />
              </motion.div>
            ))}
          </div>
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={() => loadMore(12)} className="px-8">
                Load more ads
              </Button>
            </div>
          )}
        </>
      )}

      <AdDetailModal ad={selectedAd} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
