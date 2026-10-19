import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Search, Star, Store } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { TIKTOK_SHOP_REGIONS } from "@/convex/lib/justone.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useHistoryState } from "@/hooks/use-history-state.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { anyCountryName } from "@/lib/countries.ts";
import { errorMessage } from "@/lib/errorMessage.ts";
import { price } from "@/lib/money.ts";

// TikTok Shop → Search TikTok Shop: a live search of TikTok's own shop (convex/justone.ts tiktokShopSearch, JustOne API),
// next to the Nexscope best sellers. Kept 24 h per word and region; a daily limit per user.

type Result = FunctionReturnType<typeof api.justone.tiktokShopSearch>;

const REGIONS = TIKTOK_SHOP_REGIONS.map((code) => ({ value: code, label: anyCountryName(code) }));

export default function ShopSearch() {
  const search = useAction(api.justone.tiktokShopSearch);
  const [keyword, setKeyword] = useHistoryState("shopSearch:keyword", "");
  const [region, setRegion] = useHistoryState("shopSearch:region", "US");
  // Kept per history entry, so Back from a product shows the same results.
  const [result, setResult] = useHistoryState<Result | null>("shopSearch:result", null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (keyword.trim().length < 2) return;
    setBusy(true);
    try {
      setResult(await search({ keyword, region }));
    } catch (err) {
      toast.error(errorMessage(err, "The search didn't work"));
    } finally {
      setBusy(false);
    }
  };

  const sorted = result ? [...result.items].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)) : [];

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input className="h-10 sm:h-8 w-full sm:w-72" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Product word, e.g. dog paw cleaner" aria-label="Search TikTok Shop" />
        <FilterSelect label="Region" value={region} onChange={setRegion} options={REGIONS} active />
        <Button type="submit" size="sm" className="h-10 sm:h-8" disabled={busy || keyword.trim().length < 2}>
          {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Search className="w-4 h-4 mr-2" />}
          Search
        </Button>
        {result ? <span className="text-xs text-muted-foreground">{result.left} searches left today</span> : null}
      </form>
      <p className="text-xs text-muted-foreground">
        Searches TikTok's own shop right now, sorted by units sold. TikTok Shop search covers the US, Latin America, Japan and Southeast Asia (not the UK or EU).
      </p>

      {result && !sorted.length ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <h3 className="font-semibold mb-1">Nothing on TikTok Shop {anyCountryName(result.region)} for “{result.keyword}”</h3>
          <p className="text-sm text-muted-foreground">Try a shorter or more common word.</p>
        </div>
      ) : null}

      {sorted.length ? (
        <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map((it) => (
            <li key={it.id} className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
              <a href={it.url} target="_blank" rel="noopener noreferrer" className="flex flex-col h-full group">
                <span className="block aspect-square bg-muted">
                  {it.image ? <img src={it.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" /> : null}
                </span>
                <span className="p-3 flex flex-col gap-1 flex-1 min-w-0">
                  <span className="text-sm line-clamp-2 group-hover:underline">{it.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground mt-auto">
                    {it.price ? <span className="font-semibold text-foreground">{it.currency === "USD" || !it.currency ? price(it.price) : `${it.currency} ${it.price.toFixed(2)}`}</span> : null}
                    {it.sold ? <span>{compactNumber(it.sold)} sold</span> : null}
                    {it.rating ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-current text-yellow-500" aria-hidden /> {it.rating.toFixed(1)}
                        {it.reviews ? ` (${compactNumber(it.reviews)})` : ""}
                      </span>
                    ) : null}
                  </span>
                  {it.shop ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                      <Store className="w-3 h-3 shrink-0" aria-hidden /> <span className="truncate">{it.shop}</span>
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
