import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Zap, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import AIFeatureGate from "./AIFeatureGate.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

type ScoreResult = {
  score: number;
  verdict: string;
  strengths: string[];
  risks: string[];
};

function scoreColor(score: number) {
  if (score >= 85) return "text-good";
  if (score >= 70) return "text-warn";
  return "text-bad";
}

export default function AIProductScoreCard({
  title,
  description,
  price,
  cost,
  category,
}: {
  title: string;
  description: string;
  price?: number;
  cost?: number;
  category: string;
}) {
  const scoreProduct = useAction(api.ai.scoreProduct);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await scoreProduct({ title, description, price, cost, category });
      setResult(res);
    } catch (error) {
      const message = errorMessage(error, "Failed to generate AI score. Please try again.");
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
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">AI second opinion</h3>
          </div>
          {!result && (
            <Button size="sm" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {isLoading ? "Analyzing..." : "Run AI Analysis"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          An AI read on ad potential, margin and competition, on demand. Separate from the AdSpy score above.
        </p>

        {result && (
          <div className="pt-3 border-t border-border space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full border-4 border-primary/30 flex items-center justify-center shrink-0">
                <span className={cn("text-2xl font-black", scoreColor(result.score))}>{result.score}</span>
              </div>
              <p className="text-sm leading-relaxed">{result.verdict}</p>
            </div>
            {result.strengths.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-good">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Strengths
                </div>
                <ul className="space-y-1">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground pl-4 relative before:content-['•'] before:absolute before:left-0.5 before:text-good">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.risks.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-warn">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Risks
                </div>
                <ul className="space-y-1">
                  {result.risks.map((r, i) => (
                    <li key={i} className="text-xs text-muted-foreground pl-4 relative before:content-['•'] before:absolute before:left-0.5 before:text-warn">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              Re-run analysis
            </Button>
          </div>
        )}
      </div>
    </AIFeatureGate>
  );
}
