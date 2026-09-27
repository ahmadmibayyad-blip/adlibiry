import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Heart, Eye, Calendar, Zap, ExternalLink, Bookmark, BookmarkCheck,
  Users, Target, DollarSign, ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Authenticated, Unauthenticated } from "convex/react";
import CountrySaturationCard from "../../_components/ai/CountrySaturationCard.tsx";

type Ad = Doc<"ads">;

const platformColors: Record<string, string> = {
  Facebook: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Instagram: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  TikTok: "bg-foreground/10 text-foreground border-foreground/20",
  Amazon: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function scoreColor(score: number) {
  if (score >= 85) return "text-green-400";
  if (score >= 70) return "text-yellow-400";
  return "text-red-400";
}

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{ad.headline}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Creative */}
          <div>
            <div className="rounded-xl overflow-hidden border border-border bg-muted mb-3">
              <img src={ad.creativeUrl} alt={ad.headline} className="w-full aspect-[4/3] object-cover" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", platformColors[ad.platform])}>
                {ad.platform}
              </span>
              <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                {ad.country}
              </span>
              <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                {ad.niche}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-primary mb-1">{ad.advertiserName}</div>
              <h2 className="text-lg font-bold leading-tight mb-2">{ad.headline}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{ad.bodyText}</p>
            </div>

            {/* AI Score */}
            <div className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full border-4 border-primary/30 flex items-center justify-center shrink-0">
                <span className={cn("text-base font-black", scoreColor(ad.aiScore))}>{ad.aiScore}</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-semibold">AI Winning Score</span>
                </div>
                <p className="text-xs text-muted-foreground">Runtime, engagement, and spend velocity combined.</p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                <Heart className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-bold">{ad.likes.toLocaleString()}</div>
                  <div className="text-[11px] text-muted-foreground">Likes</div>
                </div>
              </div>
              <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-bold">{ad.views}</div>
                  <div className="text-[11px] text-muted-foreground">Views</div>
                </div>
              </div>
              <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-bold">{ad.daysRunning} days</div>
                  <div className="text-[11px] text-muted-foreground">Running</div>
                </div>
              </div>
              <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-bold">{ad.spendEstimate}</div>
                  <div className="text-[11px] text-muted-foreground">Est. spend</div>
                </div>
              </div>
            </div>

            {/* Targeting */}
            <div className="bg-card border border-border rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <Target className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Estimated Targeting</h3>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Age range</span>
                  <span className="font-medium">{ad.targeting.ageRange}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gender</span>
                  <span className="font-medium">{ad.targeting.gender}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Interests</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {ad.targeting.interests.map((interest) => (
                      <span key={interest} className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2.5 flex items-start gap-1">
                <Users className="w-3 h-3 mt-0.5 shrink-0" />
                Estimated from public ad library signals — actual advertiser targeting may vary.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button asChild className="flex-1">
                <a href={ad.landingPageUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Landing Page
                </a>
              </Button>
              <Authenticated>
                <Button variant="outline" onClick={handleSave} className={cn(isSaved ? "border-primary/50 text-primary" : "")}>
                  {isSaved ? (
                    <><BookmarkCheck className="w-4 h-4 mr-2" />Saved</>
                  ) : (
                    <><Bookmark className="w-4 h-4 mr-2" />Save Ad</>
                  )}
                </Button>
              </Authenticated>
              <Unauthenticated>
                <Button variant="outline" onClick={() => toast.error("Please sign in to save ads")}>
                  <Bookmark className="w-4 h-4 mr-2" />
                  Save Ad
                </Button>
              </Unauthenticated>
            </div>

            {amazonMatches && amazonMatches.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <ShoppingBag className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Real Amazon Matches</h3>
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Real Amazon listings in the {ad.niche} niche, sourced via Nexscope.ai — same category, not necessarily this exact product.
                </p>
                <div className="space-y-2">
                  {amazonMatches.map((product) => (
                    <a
                      key={product._id}
                      href={product.supplierUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 bg-muted rounded-lg p-2 hover:bg-muted/70 transition-colors"
                    >
                      <img src={product.imageUrl} alt={product.title} className="w-10 h-10 rounded-md object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium line-clamp-1">{product.title}</div>
                        {product.price !== undefined && (
                          <div className="text-xs text-muted-foreground">${product.price}</div>
                        )}
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
