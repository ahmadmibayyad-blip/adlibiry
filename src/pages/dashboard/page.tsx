import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { motion } from "motion/react";
import { Area, AreaChart } from "recharts";
import {
  TrendingUp, TrendingDown, Bookmark, Zap, Trophy, ArrowRight, Package, Sparkles, Megaphone, Flame, ExternalLink,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { cn } from "@/lib/utils.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { openAssistant } from "@/lib/assistant.ts";
import ProductCard, { ProductCardSkeleton } from "./_components/ProductCard.tsx";
import AdCard, { AdCardSkeleton } from "./ad-spy/_components/AdCard.tsx";
import { ChartCard, TimeChart } from "./_components/charts.tsx";
import ImageSearchDialog from "./_components/ImageSearchDialog.tsx";
import type { Point } from "./_components/chartUtils.ts";
import { useAuth } from "@/hooks/use-auth.ts";
import { toast } from "sonner";
import ProductImage from "@/components/ProductImage.tsx";
import { moneyCompact, price } from "@/lib/money.ts";

// Home dashboard. The charts come from api.dashboard.overview, saved once a
// day after the product pipeline; everything else is live.

const BRAND = "var(--chart-1)";
const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});
const sum = (points: Point[]) => points.reduce((s, p) => s + p.value, 0);

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Sparkline({ points, label }: { points: Point[]; label: string }) {
  if (points.length < 2 || !sum(points)) return null;
  return (
    <ChartContainer config={{ value: { label, color: BRAND } }} className="aspect-auto h-10 w-24" aria-label={label}>
      <AreaChart data={points} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={1.5} fill="var(--color-value)" fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

// "+40%" vs the week before.
function Change({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null;
  const pct = before ? Math.round(((now - before) / before) * 100) : 100;
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", up ? "text-primary" : "text-red-500")}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  spark,
}: {
  icon: typeof Package;
  label: string;
  value: number | undefined;
  sub?: ReactNode;
  tint: string;
  spark?: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", tint)}>
          <Icon className="w-4 h-4" />
        </div>
        {spark}
      </div>
      {value === undefined ? (
        <Skeleton className="h-7 w-16 mt-3 mb-1" />
      ) : (
        <div className="text-2xl font-bold mt-3 tabular-nums">{value.toLocaleString()}</div>
      )}
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span>{label}</span>
        {sub}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-16 h-16 shrink-0" role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={BRAND} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-lg font-bold tabular-nums">{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function HeroWinner({ product }: { product: Doc<"products"> | undefined | null }) {
  if (product === undefined) return <Skeleton className="h-full min-h-56 rounded-2xl" />;
  if (product === null) {
    return (
      <div className="h-full min-h-56 flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card p-6">
        <Zap className="w-10 h-10 text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">No winners yet</h3>
        <p className="text-sm text-muted-foreground">Today's top product shows here after the daily update.</p>
      </div>
    );
  }
  const facts = [
    product.price !== undefined
      ? { label: "Price", value: price(product.price) }
      : product.originalPrice
        ? { label: "Price", value: product.originalPrice }
        : null,
    (product.linkedAds ?? 0) > 0 ? { label: "Ads found", value: compactNumber(product.linkedAds) } : null,
    (product.linkedSpend ?? 0) > 0 ? { label: "Ad spend (est.)", value: moneyCompact(product.linkedSpend ?? 0) } : null,
    (product.linkedViews ?? 0) > 0 ? { label: "Views", value: compactNumber(product.linkedViews) } : null,
  ]
    .filter((f) => f !== null)
    .slice(0, 3);
  const href = `/dashboard/products/${product._id}`;
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
      <div className="flex flex-col sm:flex-row gap-5 p-5 h-full">
        <Link to={href} className="sm:w-52 shrink-0 aspect-[4/3] sm:aspect-square rounded-xl overflow-hidden bg-muted">
          <ProductImage src={product.imageUrl} alt={product.title} loading="eager" className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
        </Link>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary mb-2">
            <Trophy className="w-3.5 h-3.5" />
            Today's top winner
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <Link to={href} className="text-lg font-bold leading-snug line-clamp-2 hover:text-primary transition-colors">
                {product.title}
              </Link>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{product.category}</span>
                {product.winnerRank !== undefined && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                    #{product.winnerRank} in {product.category}
                  </span>
                )}
              </div>
            </div>
            <ScoreRing score={product.aiScore} />
          </div>
          {facts.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              {facts.map((f) => (
                <div key={f.label} className="rounded-lg bg-background/70 border border-border px-3 py-2 min-w-0">
                  <div className="text-[11px] text-muted-foreground truncate">{f.label}</div>
                  <div className="text-sm font-semibold tabular-nums truncate">{f.value}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-auto pt-4">
            <Button asChild size="sm">
              <Link to={href}>
                View product
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a
                href={`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.title.slice(0, 80))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                Find supplier
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendingNow() {
  const trends = useQuery(api.trends.list, { direction: "Rising" });
  return (
    <div className="h-full bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Flame className="w-4 h-4 text-orange-500" />
          Trending now
        </h2>
        <Link to="/dashboard/research" className="text-xs text-primary hover:underline">
          All trends
        </Link>
      </div>
      {trends === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : trends.length === 0 ? (
        <p className="text-sm text-muted-foreground my-auto">
          No rising keywords yet. They show up when more new ads mention a product this week than last week.
        </p>
      ) : (
        <ol className="space-y-1">
          {trends.slice(0, 5).map((t, i) => (
            <li key={t._id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
              <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium capitalize truncate">{t.keyword}</div>
                <div className="text-[11px] text-muted-foreground truncate">{t.niche}</div>
              </div>
              <span className="text-xs font-semibold text-primary tabular-nums flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" />+{t.risingPercent}%
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TopNiches({ niches }: { niches: { niche: string; thisWeek: number; lastWeek: number }[] | undefined }) {
  const max = Math.max(1, ...(niches ?? []).map((n) => n.thisWeek));
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Top niches this week</h2>
        <span className="text-[11px] text-muted-foreground">new ads · vs last week</span>
      </div>
      {niches === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : niches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No new ads this week yet. This updates every morning.</p>
      ) : (
        <div className="space-y-3">
          {niches.map((n) => (
            <Link key={n.niche} to={`/dashboard/winners?niche=${encodeURIComponent(n.niche)}`} className="block text-xs group">
              <div className="flex justify-between items-center mb-1">
                <span className="font-medium group-hover:text-primary transition-colors">{n.niche}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{n.thisWeek.toLocaleString()}</span>
                  <Change now={n.thisWeek} before={n.lastWeek} />
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${n.niche}: ${n.thisWeek} new ads`}>
                <div className="h-full rounded-full" style={{ width: `${(n.thisWeek / max) * 100}%`, background: BRAND }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// The newest ads and products in AdSpy Pro, so an import shows up here first.
function JustAdded() {
  const data = useQuery(api.dashboard.justAdded, {});
  const [tab, setTab] = useState<"ads" | "products">("ads");
  const navigate = useNavigate();
  const items = data?.[tab];
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">Just added</h2>
          <div className="flex bg-muted rounded-full p-0.5 text-xs" role="tablist" aria-label="Just added">
            {(["ads", "products"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 h-7 rounded-full font-medium cursor-pointer transition-colors",
                  tab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "ads" ? "Ads" : "Products"}
              </button>
            ))}
          </div>
        </div>
        <Link
          to={tab === "ads" ? "/dashboard/ad-spy" : "/dashboard/products"}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          See all
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {items === undefined ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {Array.from({ length: 3 }).map((_, i) => (tab === "ads" ? <AdCardSkeleton key={i} /> : <ProductCardSkeleton key={i} />))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing added yet.</p>
      ) : data && tab === "ads" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {data.ads.map((ad) => (
            <AdCard key={ad._id} ad={ad} onClick={() => navigate(`/dashboard/ads/${ad._id}`)} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {data?.products.map((p) => <ProductCard key={p._id} product={p} />)}
        </div>
      )}
    </div>
  );
}

function WinnersGrid({ fallback }: { fallback: Doc<"products">[] | undefined }) {
  const summary = useQuery(api.winners.summary, {});
  const [niche, setNiche] = useState<string | undefined>(undefined);
  const feed = useQuery(api.winners.feed, { paginationOpts: { numItems: 6, cursor: null }, niche });
  // Before the first daily rebuild there's no list yet: show the older daily picks.
  const items =
    feed === undefined
      ? undefined
      : feed.page.length || niche
        ? feed.page.map((r) => ({ product: r.product, isNewToday: r.isNewToday }))
        : fallback?.map((p) => ({ product: p, isNewToday: false }));
  const tabs = (summary?.perNiche ?? []).slice(0, 7);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-bold">Today's winning products</h2>
          <div className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full border border-primary/20">
            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            Live
          </div>
        </div>
        <Link to={niche ? `/dashboard/winners?niche=${encodeURIComponent(niche)}` : "/dashboard/winners"} className="flex items-center gap-1 text-sm text-primary hover:underline">
          View all
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4" role="tablist" aria-label="Niche">
          {[{ niche: undefined as string | undefined, filled: summary?.total ?? 0 }, ...tabs].map((t) => (
            <button
              key={t.niche ?? "all"}
              role="tab"
              aria-selected={niche === t.niche}
              onClick={() => setNiche(t.niche)}
              className={cn(
                "shrink-0 px-3.5 h-8 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                niche === t.niche
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t.niche ?? "All niches"} <span className="opacity-70 tabular-nums">{t.filled}</span>
            </button>
          ))}
        </div>
      )}

      {items === undefined ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl">
          <Zap className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No winning products yet</h3>
          <p className="text-sm text-muted-foreground">They're picked every morning from products scoring {summary?.minScore ?? 65} or more.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {items.map(({ product, isNewToday }) => (
            <motion.div key={product._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <ProductCard product={product} isNewToday={isNewToday} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardHome() {
  const { user } = useAuth();
  const stats = useQuery(api.products.getDashboardStats, {});
  const overview = useQuery(api.dashboard.overview, {});
  const summary = useQuery(api.winners.summary, {});
  const top = useQuery(api.products.getWinnersOfDay, {});
  const seedProducts = useMutation(api.products.seedProducts);
  const isAdmin = useQuery(api.users.isAdmin, {});

  const handleSeed = async () => {
    await seedProducts();
    toast.success("Products seeded!");
  };

  const ads = overview?.adsPerDay ?? [];
  const adsThisWeek = sum(ads.slice(-7));
  const adsLastWeek = sum(ads.slice(-14, -7));
  const products = overview?.productsPerDay ?? [];
  const productsThisWeek = sum(products.slice(-7));

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div {...fadeUp(0)} className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1">
            {greeting()}, {user?.profile?.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="text-muted-foreground text-sm">Here's what's winning today, refreshed daily from live ad and marketplace data.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Dev seed button: admins only, only while there are no products */}
          {isAdmin && top !== undefined && top.length === 0 && (
            <Button size="sm" variant="outline" onClick={handleSeed} className="text-xs">
              Load Sample Products
            </Button>
          )}
          <ImageSearchDialog />
          <Button size="sm" variant="outline" onClick={openAssistant} className="rounded-full">
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-primary" />
            Ask AI
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div {...fadeUp(0.05)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Package}
          label="Products tracked"
          value={stats?.totalProducts}
          tint="bg-blue-500/10 text-blue-500"
          spark={<Sparkline points={products} label="New products per day" />}
          sub={productsThisWeek > 0 ? <span className="text-primary font-medium">+{compactNumber(productsThisWeek)} this week</span> : undefined}
        />
        <StatCard
          icon={Trophy}
          label="Winning products"
          value={summary === undefined ? undefined : summary.total || (stats?.winnersToday ?? 0)}
          tint="bg-yellow-500/10 text-yellow-600"
          sub={summary?.newToday ? <span className="text-primary font-medium">{summary.newToday} new today</span> : undefined}
        />
        <StatCard
          icon={Megaphone}
          label="New ads this week"
          value={overview === undefined ? undefined : adsThisWeek}
          tint="bg-primary/10 text-primary"
          spark={<Sparkline points={ads} label="New ads per day" />}
          sub={<Change now={adsThisWeek} before={adsLastWeek} />}
        />
        <StatCard icon={Bookmark} label="Saved by you" value={stats?.savedCount} tint="bg-purple-500/10 text-purple-500" />
      </motion.div>

      {/* Newest imports */}
      <motion.div {...fadeUp(0.08)}>
        <JustAdded />
      </motion.div>

      {/* Top winner + trending keywords */}
      <motion.div {...fadeUp(0.1)} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <HeroWinner product={top === undefined ? undefined : (top[0] ?? null)} />
        </div>
        <TrendingNow />
      </motion.div>

      {/* New ads chart + niches */}
      <motion.div {...fadeUp(0.15)} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 [&>div]:h-full [&>div]:rounded-2xl [&>div]:p-5 [&>div]:shadow-sm">
          <ChartCard
            title="New ads found, last 30 days"
            points={ads}
            enough={sum(ads) > 0}
            headline={<span className="tabular-nums">{compactNumber(sum(ads))} ads</span>}
          >
            <TimeChart kind="area" points={ads} label="new ads" color={BRAND} />
          </ChartCard>
        </div>
        <TopNiches niches={overview === undefined ? undefined : (overview?.topNiches ?? [])} />
      </motion.div>

      {/* Winners */}
      <motion.div {...fadeUp(0.2)}>
        <WinnersGrid fallback={top} />
      </motion.div>
    </div>
  );
}
