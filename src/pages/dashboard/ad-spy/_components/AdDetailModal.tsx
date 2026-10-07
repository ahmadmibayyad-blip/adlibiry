import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Heart, Eye, Calendar, Zap, ExternalLink, Bookmark, BookmarkCheck,
  Users, Target, DollarSign, ShoppingBag, MessageCircle, Share2, Copy, Globe, Library, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Authenticated, Unauthenticated } from "convex/react";
import CountrySaturationCard from "../../_components/ai/CountrySaturationCard.tsx";
import { compactNumber, flag, shortDate, domainOf, spendLabel } from "@/lib/adFormat.ts";
import FollowAdvertiser from "../../_components/FollowAdvertiser.tsx";
import AdMedia from "../../_components/AdMedia.tsx";
import { AdVideoAction } from "../../_components/DownloadVideoButton.tsx";
import ProductImage from "@/components/ProductImage.tsx";

type Ad = Doc<"ads">;

const platformColors: Record<string, string> = {
  Facebook: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Instagram: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  TikTok: "bg-foreground/10 text-foreground border-foreground/20",
  Amazon: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function scoreColor(score: number) {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-yellow-400";
  return "text-muted-foreground";
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}

function Bar({ label, pct, className }: { label: string; pct: number; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full bg-primary", className)} style={{ width: `${w}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums">{w.toFixed(0)}%</span>
    </div>
  );
}

// Percentages may arrive as fractions (0.42) or whole numbers (42).
const pct = (n: number | undefined) => (n === undefined ? 0 : n <= 1 ? n * 100 : n);
export default function AdDetailModal({ ad, open, onOpenChange }: { ad: Ad | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isSaved = useQuery(api.ads.isAdSaved, ad ? { adId: ad._id } : "skip");
  const toggleSave = useMutation(api.ads.toggleSaveAd);
  const amazonMatches = useQuery(api.products.listNexscopeProductsByNiche, ad ? { niche: ad.niche } : "skip");

  if (!ad) return null;

  const handleSave = async () => {
    try {
      const result = await toggleSave({ adId: ad._id });
      toast.success(result.saved ? "Ad saved to creative library!" : "Removed from saved");
    } catch {
      toast.error("Please sign in to save ads");
    }
  };

  const spend = spendLabel(ad.spendEstimate);
  const domain = domainOf(ad.landingPageUrl);
  const aud = ad.audience;
  const ages = aud?.ages ?? [];
  const audCountries = (aud?.countries ?? []).slice(0, 8);
  const male = pct(aud?.malePct);
  const female = pct(aud?.femalePct);
  const allCountries = ad.countries?.length ? ad.countries : ad.country && ad.country !== "INTL" ? [ad.country] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{ad.headline}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Creative column */}
          <div className="bg-black/40 md:border-r border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              {ad.advertiserAvatar ? (
                <img src={ad.advertiserAvatar} alt="" className="w-9 h-9 rounded-full object-cover bg-muted" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
                  {ad.advertiserName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{ad.advertiserName}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("px-1.5 rounded border", platformColors[ad.platform])}>{ad.platform}</span>
                  {ad.isActive !== undefined && (
                    <span className="flex items-center gap-1">
                      <span className={cn("w-1.5 h-1.5 rounded-full", ad.isActive ? "bg-green-400" : "bg-muted-foreground/50")} />
                      {ad.isActive ? "Active" : "Inactive"}
                    </span>
                  )}
                  <span>· {ad.niche}</span>
                </div>
              </div>
              <FollowAdvertiser name={ad.advertiserName} className="ml-auto shrink-0" />
            </div>

            <div className="rounded-xl overflow-hidden border border-border bg-muted">
              <AdMedia ad={ad} maxHeight="60vh" />
            </div>
            <AdVideoAction ad={ad} className="w-full" />

            <div className="text-sm whitespace-pre-line leading-relaxed max-h-56 overflow-y-auto pr-1">
              {ad.headline && ad.headline !== ad.bodyText && <div className="font-semibold mb-1">{ad.headline}</div>}
              <span className="text-muted-foreground">{ad.bodyText}</span>
              {ad.ctaText && (
                <div className="mt-2">
                  <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-md bg-muted border border-border">{ad.ctaText}</span>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                navigator.clipboard?.writeText([ad.headline, ad.bodyText].filter(Boolean).join("\n\n"));
                toast.success("Ad copy copied");
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />Copy ad text
            </Button>
          </div>

          {/* Data column */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full border-4 border-primary/30 flex items-center justify-center shrink-0">
                <span className={cn("text-base font-black", scoreColor(ad.aiScore))}>{ad.aiScore}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Zap className="w-3.5 h-3.5 text-primary" />Winning score
                </div>
                <p className="text-xs text-muted-foreground">Runtime, engagement, reach and ad copies combined.</p>
              </div>
              {(ad.relatedAdsCount ?? 0) > 1 && (
                <div className="text-right">
                  <div className="text-lg font-black text-primary">×{ad.relatedAdsCount}</div>
                  <div className="text-[11px] text-muted-foreground">ad copies</div>
                </div>
              )}
            </div>

            {/* Only the numbers we have: missing data is left out, not shown as "—". */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { icon: Eye, label: "Impressions", value: ad.impressions ? compactNumber(ad.impressions) : ad.views && ad.views !== "0" && ad.views !== "—" ? ad.views : undefined },
                { icon: Heart, label: "Likes", value: ad.likes > 0 ? compactNumber(ad.likes) : undefined },
                { icon: MessageCircle, label: "Comments", value: ad.comments ? compactNumber(ad.comments) : undefined },
                { icon: Share2, label: "Shares", value: ad.shares ? compactNumber(ad.shares) : undefined },
                { icon: DollarSign, label: "Est. spend", value: spend ?? undefined },
                { icon: Users, label: "Reach", value: aud?.totalReach ? compactNumber(aud.totalReach) : undefined },
                { icon: Calendar, label: "Days running", value: ad.daysRunning > 0 ? `${ad.daysRunning}` : undefined },
                { icon: Globe, label: "Countries", value: allCountries.length ? `${allCountries.length}` : undefined },
              ]
                .filter((s): s is typeof s & { value: string } => !!s.value)
                .map((s) => (
                  <Stat key={s.label} icon={s.icon} label={s.label} value={s.value} />
                ))}
            </div>

            {/* Timeline */}
            <div className="bg-card border border-border rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
                <Clock className="w-4 h-4 text-primary" />Timeline
              </div>
              <div className="flex items-center gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">First seen</div>
                  <div className="font-semibold">{shortDate(ad.firstSeenAt)}</div>
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-gradient-to-r from-primary/30 to-primary" />
                <div className="text-right">
                  <div className="text-muted-foreground">Last seen</div>
                  <div className="font-semibold">{ad.isActive ? "Still running" : shortDate(ad.lastSeenAt)}</div>
                </div>
              </div>
            </div>

            {/* Audience */}
            <div className="bg-card border border-border rounded-xl p-3.5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Target className="w-4 h-4 text-primary" />Audience
              </div>
              {aud && (male > 0 || female > 0) ? (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-blue-400">Male {male.toFixed(0)}%</span>
                    <span className="text-pink-400">Female {female.toFixed(0)}%</span>
                  </div>
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                    <div className="bg-blue-500" style={{ width: `${male}%` }} />
                    <div className="bg-pink-500" style={{ width: `${female}%` }} />
                  </div>
                </div>
              ) : (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Gender</span>
                  <span className="font-medium">{ad.targeting.gender}</span>
                </div>
              )}
              {ages.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Age</div>
                  {ages.map((a) => (
                    <Bar key={a.bracket} label={a.bracket} pct={pct(a.pct)} />
                  ))}
                </div>
              ) : (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Age range</span>
                  <span className="font-medium">{ad.targeting.ageRange}</span>
                </div>
              )}
              {audCountries.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Top countries by reach</div>
                  {audCountries.map((c) => (
                    <Bar key={c.code} label={`${flag(c.code)} ${c.code}`} pct={pct(c.pct)} className="bg-primary/80" />
                  ))}
                </div>
              )}
              {!audCountries.length && allCountries.length > 0 && (
                <div className="text-xs">
                  <div className="text-muted-foreground mb-1">Running in</div>
                  <div className="flex flex-wrap gap-1">
                    {allCountries.slice(0, 30).map((c) => (
                      <span key={c} className="bg-muted rounded px-1.5 py-0.5">{flag(c)} {c}</span>
                    ))}
                  </div>
                </div>
              )}
              {ad.targeting.interests.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ad.targeting.interests.map((i) => (
                    <span key={i} className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{i}</span>
                  ))}
                </div>
              )}
              {!aud && (
                <p className="text-[11px] text-muted-foreground">Detailed audience data is still being fetched for this ad.</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {ad.landingPageUrl && (
                <Button asChild className="flex-1 min-w-[10rem]">
                  <a href={ad.landingPageUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {ad.ctaText ? `${ad.ctaText} · ` : ""}{domain || "Landing page"}
                  </a>
                </Button>
              )}
              {ad.adLibraryUrl && (
                <Button asChild variant="outline">
                  <a href={ad.adLibraryUrl} target="_blank" rel="noopener noreferrer">
                    <Library className="w-4 h-4 mr-2" />Ad Library
                  </a>
                </Button>
              )}
              <Authenticated>
                <Button variant="outline" onClick={handleSave} className={cn(isSaved ? "border-primary/50 text-primary" : "")}>
                  {isSaved ? <><BookmarkCheck className="w-4 h-4 mr-2" />Saved</> : <><Bookmark className="w-4 h-4 mr-2" />Save</>}
                </Button>
              </Authenticated>
              <Unauthenticated>
                <Button variant="outline" onClick={() => toast.error("Please sign in to save ads")}>
                  <Bookmark className="w-4 h-4 mr-2" />Save
                </Button>
              </Unauthenticated>
            </div>

            {amazonMatches && amazonMatches.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-2.5 text-sm font-semibold">
                  <ShoppingBag className="w-4 h-4 text-primary" />Similar products in {ad.niche}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {amazonMatches.map((product) => (
                    <a
                      key={product._id}
                      href={product.supplierUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-muted rounded-lg p-2 hover:bg-muted/70 transition-colors"
                    >
                      <ProductImage src={product.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium line-clamp-1">{product.title}</div>
                        {product.price !== undefined && <div className="text-xs text-muted-foreground">${product.price}</div>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <CountrySaturationCard productTitle={ad.headline} niche={ad.niche} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
