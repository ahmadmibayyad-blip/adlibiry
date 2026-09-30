import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api.js";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { FileText, Sparkles, TrendingUp, AlertTriangle, Users, Gauge } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AIFeatureGate from "./AIFeatureGate.tsx";

type Niche = Doc<"niches">;

type Report = {
  summary: string;
  opportunities: string[];
  risks: string[];
  recommendedAudience: string;
  competitionLevel: "Low" | "Medium" | "High";
};

const competitionColors: Record<string, string> = {
  Low: "text-green-400 bg-green-400/10 border-green-400/20",
  Medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  High: "text-red-400 bg-red-400/10 border-red-400/20",
};

export default function AINicheReportModal({ niche, open, onOpenChange }: { niche: Niche | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const generateNicheReport = useAction(api.nicheReport.generate);
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!niche) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await generateNicheReport({ niche: niche.name });
      setReport(res);
    } catch (error) {
      const message =
        error instanceof ConvexError && typeof (error.data as { message?: unknown })?.message === "string"
          ? (error.data as { message: string }).message
          : "Failed to generate niche report";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setReport(null); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            AI Niche Report — {niche.name}
          </DialogTitle>
        </DialogHeader>

        <AIFeatureGate>
          {!report ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">
                Generate a full market analysis for {niche.name} — opportunities, risks, and audience targeting.
              </p>
              <Button onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
                {isLoading ? "Analyzing market..." : "Generate Report"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border flex items-center gap-1", competitionColors[report.competitionLevel])}>
                  <Gauge className="w-3 h-3" />
                  {report.competitionLevel} competition
                </span>
              </div>

              <p className="text-sm leading-relaxed">{report.summary}</p>

              <div className="bg-card border border-border rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  <h4 className="text-xs font-semibold">Recommended Audience</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{report.recommendedAudience}</p>
              </div>

              {report.opportunities.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-green-400">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Opportunities
                  </div>
                  <ul className="space-y-1.5">
                    {report.opportunities.map((o, i) => (
                      <li key={i} className="text-xs text-muted-foreground pl-4 relative before:content-['•'] before:absolute before:left-0.5 before:text-green-400">
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.risks.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-yellow-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Risks
                  </div>
                  <ul className="space-y-1.5">
                    {report.risks.map((r, i) => (
                      <li key={i} className="text-xs text-muted-foreground pl-4 relative before:content-['•'] before:absolute before:left-0.5 before:text-yellow-400">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isLoading} className="w-full">
                {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                Regenerate report
              </Button>
            </div>
          )}
        </AIFeatureGate>
      </DialogContent>
    </Dialog>
  );
}
