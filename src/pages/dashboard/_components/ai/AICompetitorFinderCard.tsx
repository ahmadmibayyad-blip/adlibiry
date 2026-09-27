import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Users, Sparkles, ExternalLink, Megaphone, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import AIFeatureGate from "./AIFeatureGate.tsx";

type CompetitorResult = {
  summary: string;
  rankedMatches: { name: string; whyRelevant: string }[];
  matchedAds: { advertiserName: string; platform: string; niche: string; headline: string }[];
  matchedStores: { name: string; niche: string; url: string }[];
};

export default function AICompetitorFinderCard({
  productTitle,
  category,
}: {
  productTitle: string;
  category: string;
}) {
  const findCompetitors = useAction(api.ai.findCompetitors);
  const [result, setResult] = useState<CompetitorResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await findCompetitors({ productTitle, category });
      setResult(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to find competitors";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AIFeatureGate>
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">AI Competitor Finder</h3>
          </div>
          {!result && (
            <Button size="sm" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {isLoading ? "Searching..." : "Find Competitors"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Cross-references your Ad Spy and Store Tracker data — only real tracked matches, never invented.
        </p>

        {result && (
          <div className="pt-3 border-t border-border space-y-3">
            <p className="text-sm leading-relaxed">{result.summary}</p>

            {result.rankedMatches.length > 0 && (
              <div className="space-y-2">
                {result.rankedMatches.map((m, i) => (
                  <div key={i} className="bg-muted rounded-lg p-3">
                    <div className="font-medium text-sm mb-0.5">{m.name}</div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{m.whyRelevant}</p>
                  </div>
                ))}
              </div>
            )}

            {(result.matchedAds.length > 0 || result.matchedStores.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {result.matchedAds.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
                      <Megaphone className="w-3.5 h-3.5" />
                      Tracked in Ad Spy
                    </div>
                    <ul className="space-y-1">
                      {result.matchedAds.slice(0, 5).map((a, i) => (
                        <li key={i} className="text-xs text-muted-foreground">{a.advertiserName} · {a.platform}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.matchedStores.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
                      <StoreIcon className="w-3.5 h-3.5" />
                      Tracked stores
                    </div>
                    <ul className="space-y-1">
                      {result.matchedStores.slice(0, 5).map((s, i) => (
                        <li key={i}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {s.name}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              Search again
            </Button>
          </div>
        )}
      </div>
    </AIFeatureGate>
  );
}
