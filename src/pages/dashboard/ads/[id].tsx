import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, ExternalLink, Info, Package } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { compactNumber, flag, spendLabel } from "@/lib/adFormat.ts";
import { gmvFromText, parseCompact } from "@/convex/lib/productMatch.ts";
import AdDetailModal from "../ad-spy/_components/AdDetailModal.tsx";
import AdCard from "../ad-spy/_components/AdCard.tsx";
import FollowAdvertiser from "../_components/FollowAdvertiser.tsx";
import ProductTools from "../_components/ProductTools.tsx";
import AdMedia from "../_components/AdMedia.tsx";
import { AdVideoAction } from "../_components/DownloadVideoButton.tsx";
import { ChartCard, CollectingData, ComparisonRow, RangeSwitch, StatTile, TimeChart } from "../_components/charts.tsx";
import { dailyChange, money, pct, SERIES, type Point, type Range } from "../_components/chartUtils.ts";

type Ad = Doc<"ads">;

const adViews = (ad: Ad): number => ad.impressions ?? parseCompact(ad.views) ?? 0;

function SaveAd({ adId }: { adId: Id<"ads"> }) {
  const saved = useQuery(api.ads.isAdSaved, { adId });
  const toggle = useMutation(api.ads.toggleSaveAd);
  return (
    <Button
      className="flex-1"
      variant={saved ? "outline" : "default"}
      onClick={async () => {
        try {
          const r = await toggle({ adId });
          toast.success(r.saved ? "Ad saved" : "Removed from saved");
        } catch {
          toast.error("Please sign in to save ads");
        }
      }}
    >
      {saved ? <BookmarkCheck className="w-4 h-4 mr-2" /> : <Bookmark className="w-4 h-4 mr-2" />}
      {saved ? "Saved" : "Save ad"}
    </Button>
  );
}

function ProductInAd({ productId }: { productId: Id<"products"> }) {
  const product = useQuery(api.products.getById, { id: productId });
  if (!product) return null;
  return (
    <Link
      to={`/dashboard/products/${product._id}`}
      className="flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 hover:bg-primary/10 transition-colors"
    >
      <div className="w-12 h-12 rounded-lg bg-card overflow-hidden flex items-center justify-center shrink-0">
        {product.imageUrl ? <img src={product.imageUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-primary" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-primary">Product in this ad</div>
        <div className="font-semibold truncate">{product.title}</div>
        <div className="text-xs text-muted-foreground">
          {product.winnerRank !== undefined ? `Winner, #${product.winnerRank} in ${product.category}` : product.category}
          {(product.linkedAds ?? 0) > 1 && `, ${product.linkedAds} ads grouped`}
        </div>
      </div>
      <span className="text-sm font-medium text-primary flex items-center shrink-0">
        Open product
      </span>
    </Link>
  );
}

export default function AdDetailPage() {
  const { id } = useParams<{ id: string }>();
  const adId = id as Id<"ads">;
  const ad = useQuery(api.ads.getById, id ? { id: adId } : "skip");
  const [range, setRange] = useState<Range>(30);
  const history = useQuery(api.history.adHistory, id ? { adId, days: range } : "skip");
  const comparison = useQuery(api.history.adNicheComparison, id ? { adId } : "skip");
  const [details, setDetails] = useState(false);

  if (ad === undefined) {
    return (
      <div className="p-5 lg:p-8 max-w-7xl mx-auto grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Skeleton className="aspect-[9/16] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }
  if (!ad) {
    return (
      <div className="p-8 text-center">
        <h2 className="font-semibold text-lg mb-2">Ad not found</h2>
        <Link to="/dashboard/ad-spy" className="text-primary hover:underline text-sm">← Back to Ad Spy</Link>
      </div>
    );
  }

  const rows = history ?? [];
  const enough = rows.length >= 2;
  const series = (get: (r: (typeof rows)[number]) => number): Point[] => rows.map((r) => ({ day: r.day, value: get(r) }));
  const newViews = dailyChange(series((r) => r.views));
  const likes = series((r) => r.likes);
  const comments = series((r) => r.comments);
  const peak = newViews.reduce((m, p) => Math.max(m, p.value), 0);
  const spend = spendLabel(ad.spendEstimate);
  const gmv = ad.gmv ?? gmvFromText(ad.bodyText) ?? 0;

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <nav className="text-sm text-muted-foreground mb-4" aria-label="Breadcrumb">
        <Link to="/dashboard/ad-spy" className="text-primary hover:underline">Ad Spy</Link>
        <span className="mx-2">/</span>
        <span>{ad.advertiserName}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-border bg-black">
            <AdMedia ad={ad} />
          </div>
          <div className="flex gap-2">
            <Authenticated>
              <SaveAd adId={ad._id} />
            </Authenticated>
            <AdVideoAction ad={ad} label="Video" />
            {ad.landingPageUrl && (
              <Button asChild variant="outline" className="flex-1">
                <a href={ad.landingPageUrl} target="_blank" rel="noopener noreferrer">
                  Landing page <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setDetails(true)}>
            <Info className="w-3.5 h-3.5 mr-1.5" />
            Audience, timeline & ad copy
          </Button>
        </div>

        <div className="space-y-5 min-w-0">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-foreground text-background">{ad.platform}</span>
              {ad.country && <span className="text-xs px-2 py-0.5 rounded bg-muted">{flag(ad.country)} {ad.country}</span>}
              {ad.mediaType && <span className="text-xs px-2 py-0.5 rounded bg-muted capitalize">{ad.mediaType}</span>}
              <span className="text-xs px-2 py-0.5 rounded bg-muted">{ad.niche}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-foreground text-background">Ad score {ad.aiScore}</span>
            </div>
            <div className="flex items-center gap-2 mb-2 min-w-0">
              {ad.advertiserAvatar && <img src={ad.advertiserAvatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />}
              <span className="text-sm font-semibold truncate">{ad.advertiserName}</span>
              <FollowAdvertiser name={ad.advertiserName} className="shrink-0" />
            </div>
            <h1 className="font-display text-2xl font-bold leading-tight mb-1">“{ad.headline}”</h1>
            <p className="text-sm text-muted-foreground line-clamp-3">{ad.bodyText}</p>
            {ad.ctaText && (
              <span className="inline-block mt-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-muted border border-border">{ad.ctaText}</span>
            )}
            {/* Only the numbers we have: missing data is left out, not shown as "—". */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 mt-4">
              {ad.daysRunning > 0 && <StatTile label="Running" value={`${ad.daysRunning} days`} />}
              {adViews(ad) ? <StatTile label="Views" value={compactNumber(adViews(ad))} /> : null}
              {ad.likes ? <StatTile label="Likes" value={compactNumber(ad.likes)} /> : null}
              {ad.comments ? <StatTile label="Comments" value={compactNumber(ad.comments)} /> : null}
              {/* "up to $45K" doesn't fit the tile: the "up to" goes in the label. */}
              {spend && (
                <StatTile
                  label={/^up to /i.test(spend) ? "Spend (est., max)" : "Spend (est.)"}
                  value={spend.replace(/^up to\s*/i, "")}
                  hint={spend}
                />
              )}
              {gmv ? <StatTile label="GMV" value={money(gmv)} /> : null}
            </div>
          </div>

          {ad.productId && <ProductInAd productId={ad.productId} />}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">How this ad is doing</h2>
            <RangeSwitch value={range} onChange={setRange} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="New views per day"
              points={newViews}
              enough={enough}
              firstDay={rows[0]?.day}
              headline={peak ? <span className="tabular-nums">peak {compactNumber(peak)}</span> : undefined}
            >
              <TimeChart kind="bar" points={newViews} label="new views" />
            </ChartCard>
            <div className="bg-card border border-border rounded-xl p-4 min-w-0">
              <h3 className="text-sm font-semibold mb-3">Likes & comments (total)</h3>
              {!enough ? (
                <CollectingData firstDay={rows[0]?.day} />
              ) : (
                // Two small charts, each on its own scale — comments are far fewer than likes.
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <span className="w-3 h-0.5 rounded" style={{ background: SERIES.primary }} />Likes
                    </div>
                    <TimeChart kind="line" points={likes} label="likes" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <span className="w-3 h-0.5 rounded" style={{ background: SERIES.second }} />Comments
                    </div>
                    <TimeChart kind="line" points={comments} label="comments" color={SERIES.second} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {comparison && comparison.peers > 1 && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Compared with other ads in {comparison.niche}</h3>
                <span className="text-xs text-muted-foreground">{comparison.peers} ads</span>
              </div>
              <ComparisonRow label="Views" {...comparison.views} format={compactNumber} />
              <ComparisonRow label="Engagement rate" {...comparison.engagement} format={pct} />
              <ComparisonRow label="Days running" {...comparison.daysRunning} format={(n) => `${Math.round(n)} d`} />
              <p className={cn("text-[11px] text-muted-foreground")}>Bar = this ad. Tick = niche median.</p>
            </div>
          )}
        </div>
      </div>

      <AdTools ad={ad} />

      <MoreFromAdvertiser name={ad.advertiserName} adId={ad._id} />

      <AdDetailModal ad={ad} open={details} onOpenChange={setDetails} />
    </div>
  );
}

/** The product page's tools for the product in this ad, or for the ad's own text when it isn't linked to a product. */
function AdTools({ ad }: { ad: Ad }) {
  const product = useQuery(api.products.getById, ad.productId ? { id: ad.productId } : "skip");
  if (ad.productId && product === undefined) return null;
  const subject = product
    ? product
    : { title: ad.headline || ad.bodyText.slice(0, 120), description: ad.bodyText, category: ad.niche };
  return <ProductTools product={product ?? undefined} subject={subject} />;
}

function MoreFromAdvertiser({ name, adId }: { name: string; adId: Id<"ads"> }) {
  const ads = useQuery(api.follows.advertiserAds, { name, excludeId: adId });
  const navigate = useNavigate();
  if (!ads?.length) return null;
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xl font-bold truncate">More from {name}</h2>
        <FollowAdvertiser name={name} className="shrink-0" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ads.map((a) => (
          <AdCard key={a._id} ad={a} onClick={() => navigate(`/dashboard/ads/${a._id}`)} />
        ))}
      </div>
    </section>
  );
}
