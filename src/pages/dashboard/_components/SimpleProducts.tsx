import { useState } from "react";
import { Link } from "react-router-dom";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Check, CircleAlert, Zap } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import ProductImage from "@/components/ProductImage.tsx";
import { useMyNiches } from "@/hooks/use-my-niches.ts";
import { cn } from "@/lib/utils.ts";
import { price } from "@/lib/money.ts";
import { shortTitle, simpleVerdict } from "@/lib/simpleVerdict.ts";

// Simple view's "Find products": today's winning products as big cards with a
// plain verdict, one row of categories, no filters. Full view has the rest.

const PAGE = 12;

export default function SimpleProducts() {
  const summary = useQuery(api.winners.summary, {});
  const { niches: myNiches } = useMyNiches();
  const [niche, setNiche] = useState<string | undefined>();
  const args = niche ? { niche, mode: "mixed" as const } : { mode: "mixed" as const, ...(myNiches.length ? { niches: myNiches } : {}) };
  const { results, status, loadMore } = usePaginatedQuery(api.winners.feed, args, { initialNumItems: PAGE });
  const categories = (summary?.perNiche ?? []).slice(0, 6);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-12 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Products selling well right now</h1>
        <p className="text-lg text-muted-foreground mt-2">Picked fresh every few days. Open one to see its ads and where to buy it.</p>
      </div>

      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Category">
          {[{ niche: undefined as string | undefined }, ...categories].map((c) => (
            <button
              key={c.niche ?? "all"}
              type="button"
              aria-pressed={niche === c.niche}
              onClick={() => setNiche(c.niche)}
              className={cn(
                "shrink-0 h-11 px-5 rounded-full text-[15px] font-medium border transition-colors cursor-pointer",
                niche === c.niche ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c.niche ?? (myNiches.length ? "My categories" : "All")}
            </button>
          ))}
        </div>
      )}

      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-96 rounded-2xl" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center text-center rounded-2xl border border-dashed border-border bg-card p-10">
          <Zap className="w-10 h-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">No products here yet</h2>
          <p className="text-muted-foreground">New ones are picked every few days. Try another category.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {results.map(({ product }) => {
            const v = simpleVerdict(product, price);
            return (
              <li key={product._id}>
                <Link
                  to={`/dashboard/products/${product._id}`}
                  className="flex flex-col h-full rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <ProductImage src={product.imageUrl} alt={product.title} className="w-full aspect-square object-cover bg-muted" />
                  <div className="flex flex-col gap-3 p-5">
                    <span
                      className={cn(
                        "self-start inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
                        v.good ? "bg-primary/10 text-primary" : "bg-warn/10 text-warn",
                      )}
                    >
                      {v.good ? <Check className="w-4 h-4" /> : <CircleAlert className="w-4 h-4" />}
                      {v.label}
                    </span>
                    <h2 className="text-lg font-semibold leading-snug" title={product.title}>{shortTitle(product.title)}</h2>
                    {v.reasons[0] && <p className="text-muted-foreground">{v.reasons[0].text}</p>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadMore(PAGE)}
            className="h-14 px-8 rounded-xl border border-border bg-card text-lg font-medium hover:bg-secondary cursor-pointer"
          >
            Show more products
          </button>
        </div>
      )}
    </div>
  );
}
