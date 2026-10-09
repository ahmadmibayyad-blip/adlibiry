import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePaginatedQuery } from "convex/react";
import { ShoppingBag } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import MyNichesChip from "@/components/MyNichesChip.tsx";
import { useMyNiches } from "@/hooks/use-my-niches.ts";
import { cn } from "@/lib/utils.ts";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import TrialLimitNotice from "../_components/TrialLimitNotice.tsx";
import AdCard from "../ad-spy/_components/AdCard.tsx";

// Everything from TikTok in one place:
// - Best sellers: TikTok Shop products ranked by estimated monthly sales from the
//   shop's own daily sales counts (Nexscope data, refreshed daily).
// - From TikTok ads: the products behind the TikTok ads in Ad Spy.
// - TikTok ads: the TikTok ads themselves (Ad Spy with the TikTok filter).

const TABS = [
  { key: "best", label: "Best sellers" },
  { key: "advertised", label: "From TikTok ads" },
  { key: "ads", label: "TikTok ads" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const PAGE = 24;
const GRID = "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4";
const AD_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"; // as in Ad Spy

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-xl">
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function LoadMore({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <div className="flex justify-center mt-6">
      <Button variant="outline" onClick={onClick}>
        Load more
      </Button>
    </div>
  );
}

function BestSellers({ niches }: { niches?: string[] }) {
  const { results, status, loadMore } = usePaginatedQuery(api.products.tiktokShop, niches ? { niches } : {}, { initialNumItems: PAGE });
  if (status === "LoadingFirstPage") return <ProductSkeletons />;
  if (!results.length) return <Empty title="No TikTok Shop products yet" hint={`They're imported every morning. Try turning off "My niches".`} />;
  return (
    <>
      <div className={GRID}>
        {results.map((p) => (
          <ProductCard key={p._id} product={p} />
        ))}
      </div>
      <LoadMore show={status === "CanLoadMore"} onClick={() => loadMore(PAGE)} />
    </>
  );
}

function FromTikTokAds({ niches }: { niches?: string[] }) {
  const { results, status, loadMore } = usePaginatedQuery(api.products.tiktokAdvertised, niches ? { niches } : {}, { initialNumItems: 48 });
  // A product with several TikTok ads comes back once per page: show it once.
  const products = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((p: Doc<"products">) => {
      if (seen.has(p._id)) return false;
      seen.add(p._id);
      return true;
    });
  }, [results]);
  // Many TikTok ads aren't linked to a product, so a page can come back short: keep reading until the grid is full.
  const [target, setTarget] = useState(PAGE);
  const topUps = useRef(0);
  useEffect(() => {
    if (status === "CanLoadMore" && products.length < target && topUps.current < 10) {
      topUps.current++;
      loadMore(96);
    }
  }, [status, products.length, target, loadMore]);
  if (status === "LoadingFirstPage") return <ProductSkeletons />;
  if (!products.length && status !== "LoadingMore")
    return <Empty title="No products from TikTok ads yet" hint={`They appear once TikTok ads in Ad Spy are linked to a product. Try turning off "My niches".`} />;
  return (
    <>
      <div className={GRID}>
        {products.map((p) => (
          <ProductCard key={p._id} product={p} />
        ))}
      </div>
      <LoadMore
        show={status === "CanLoadMore"}
        onClick={() => {
          topUps.current = 0;
          setTarget(products.length + PAGE);
        }}
      />
    </>
  );
}

function TikTokAds({ niches }: { niches?: string[] }) {
  const navigate = useNavigate();
  const { results, status, loadMore } = usePaginatedQuery(api.ads.list, { platform: "TikTok", ...(niches ? { niches } : {}) }, { initialNumItems: PAGE });
  if (status === "LoadingFirstPage")
    return (
      <div className={AD_GRID}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
        ))}
      </div>
    );
  if (!results.length) return <Empty title="No TikTok ads yet" hint={`They're imported every morning. Try turning off "My niches".`} />;
  return (
    <>
      <div className={AD_GRID}>
        {results.map((ad) => (
          <AdCard key={ad._id} ad={ad} onClick={() => navigate(`/dashboard/ads/${ad._id}`)} />
        ))}
      </div>
      <LoadMore show={status === "CanLoadMore"} onClick={() => loadMore(PAGE)} />
    </>
  );
}

function ProductSkeletons() {
  return (
    <div className={GRID}>
      {Array.from({ length: 8 }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default function TikTokShopPage() {
  const { niches } = useMyNiches();
  const [useMine, setUseMine] = useState(true);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.key === params.get("tab")) ? (params.get("tab") as Tab) : "best";
  const mine = useMine && niches.length ? niches : undefined;

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <ShoppingBag className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">TikTok Shop</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Everything from TikTok: the shop's best sellers (ranked by estimated sales per month, updated every morning), the products
            behind TikTok ads, and the TikTok ads themselves.
          </p>
        </div>
        <MyNichesChip niches={niches} on={useMine && niches.length > 0} onToggle={() => setUseMine(!useMine)} />
      </div>

      <div role="tablist" aria-label="TikTok" className="inline-flex rounded-lg border border-border bg-muted/50 p-1 mb-5 max-w-full overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === "best" ? {} : { tab: t.key }, { replace: true })}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md whitespace-nowrap cursor-pointer transition-colors",
              tab === t.key ? "bg-card shadow-sm font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <TrialLimitNotice />
      {tab === "best" && <BestSellers niches={mine} />}
      {tab === "advertised" && <FromTikTokAds niches={mine} />}
      {tab === "ads" && <TikTokAds niches={mine} />}
    </div>
  );
}
