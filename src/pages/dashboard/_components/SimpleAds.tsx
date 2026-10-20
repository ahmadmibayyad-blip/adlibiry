import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePaginatedQuery } from "convex/react";
import { PlayCircle } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { useMyNiches } from "@/hooks/use-my-niches.ts";
import { cn } from "@/lib/utils.ts";
import AdCard, { AdCardSkeleton } from "../ad-spy/_components/AdCard.tsx";

// Simple view's "Ads": two plain choices instead of Ad Spy's filters, live ads only.
// Most EU reach = most est. spend (lib/euSpend.ts); "longest running" led with years-old brand ads.

const PAGE = 12;
const choices = [
  { sort: "highestSpend", label: "Most money spent", hint: "Shops are spending the most on these right now, so they are probably selling." },
  { sort: "newest", label: "Just started", hint: "New ads from the last few days. See what's starting now." },
] as const;

export default function SimpleAds() {
  const navigate = useNavigate();
  const { niches: myNiches } = useMyNiches();
  const [sort, setSort] = useState<(typeof choices)[number]["sort"]>("highestSpend");
  const args = { sort, activeOnly: true, ...(myNiches.length ? { niches: myNiches } : {}) };
  const { results, status, loadMore } = usePaginatedQuery(api.ads.list, args, { initialNumItems: PAGE });
  const choice = choices.find((c) => c.sort === sort)!;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-12 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Ads that are working</h1>
        <p className="text-lg text-muted-foreground mt-2">Videos other shops pay to show. Open one to watch it and see the product.</p>
      </div>

      <div className="space-y-3">
        <div role="group" aria-label="Show" className="inline-flex bg-muted rounded-full p-1">
          {choices.map((c) => (
            <button
              key={c.sort}
              type="button"
              aria-pressed={sort === c.sort}
              onClick={() => setSort(c.sort)}
              className={cn(
                "h-11 px-5 rounded-full text-[15px] font-medium transition-colors cursor-pointer",
                sort === c.sort ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground">{choice.hint}</p>
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <AdCardSkeleton key={i} />)}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center text-center rounded-2xl border border-dashed border-border bg-card p-10">
          <PlayCircle className="w-10 h-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">No ads here yet</h2>
          <p className="text-muted-foreground">New ads come in every day. Try the other choice above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {results.map((ad) => (
            <AdCard key={ad._id} ad={ad} onClick={() => navigate(`/dashboard/ads/${ad._id}`)} />
          ))}
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadMore(PAGE)}
            className="h-14 px-8 rounded-xl border border-border bg-card text-lg font-medium hover:bg-secondary cursor-pointer"
          >
            Show more ads
          </button>
        </div>
      )}
    </div>
  );
}
