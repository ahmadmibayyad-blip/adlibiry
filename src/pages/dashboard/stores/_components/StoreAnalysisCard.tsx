import { useState } from "react";
import { useAction } from "convex/react";
import { AlertTriangle, Copy, EyeOff, Sparkles, Swords, ThumbsDown, ThumbsUp, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { analysisText, type StoreAnalysis } from "@/convex/lib/storeAnalysis.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Store Inspector → "Analyze this store": the AI's read of the store (convex/ai.ts analyzeStore).

function Block({ icon: Icon, title, items, tone }: { icon: typeof Sparkles; title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <h4 className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${tone ?? "text-muted-foreground"}`}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </h4>
      <ul className="space-y-1 text-sm list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export default function StoreAnalysisCard({ inspectionId, host, initial }: { inspectionId: Id<"storeInspections">; host: string; initial: StoreAnalysis | null }) {
  const analyze = useAction(api.ai.analyzeStore);
  const [analysis, setAnalysis] = useState<StoreAnalysis | null>(initial);
  const [busy, setBusy] = useState(false);
  const shown = analysis ?? initial;

  const run = async () => {
    setBusy(true);
    try {
      setAnalysis(await analyze({ inspectionId }));
    } catch (err) {
      toast.error(errorMessage(err, "The analysis didn't work"));
    } finally {
      setBusy(false);
    }
  };

  if (!shown) {
    return (
      <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" /> Analyze this store with AI
          </p>
          <p className="text-xs text-muted-foreground">What it does to sell, what to copy and how to beat it, from its page, apps and ads.</p>
        </div>
        <Button size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" /> AI analysis
        </h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(analysisText(host, shown)).then(
                () => toast.success("Copied"),
                () => toast.error("Couldn't copy. Select the text and copy it instead."),
              );
            }}
          >
            <Copy className="w-4 h-4 mr-1.5" /> Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run()} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <Wand2 className="w-4 h-4 mr-1.5" />} Analyze again
          </Button>
        </div>
      </div>
      <p className="text-sm font-medium">{shown.verdict}</p>
      {shown.strengths.length ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <ThumbsUp className="w-3.5 h-3.5" /> What they do well
          </h4>
          <ul className="space-y-1 text-sm list-disc pl-5">
            {shown.strengths.map((s) => (
              <li key={s.point}>
                {s.point}
                {s.evidence ? <span className="text-muted-foreground"> · {s.evidence}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Block icon={Copy} title="Copy this" items={shown.copy} tone="text-primary" />
      <Block icon={Swords} title="How to beat them" items={shown.beat} tone="text-primary" />
      <Block icon={ThumbsDown} title="Their weak spots" items={shown.weaknesses} />
      <Block icon={AlertTriangle} title="Don't copy" items={shown.warnings} tone="text-amber-600 dark:text-amber-400" />
      <Block icon={EyeOff} title="AdSpy couldn't see" items={shown.missing} />
      <p className="text-xs text-muted-foreground">Based on what the store's page and ads show. Numbers the store displays aren't verified.</p>
    </div>
  );
}
