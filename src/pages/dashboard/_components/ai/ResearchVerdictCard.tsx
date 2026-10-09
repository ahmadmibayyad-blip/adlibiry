import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, ArrowRight, ClipboardList, Lightbulb, Microscope, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { FEE_FIXED, FEE_PCT, type EvidenceLabel, type Margin, type ResearchReport, type ReviewSample } from "@/convex/lib/researchReport.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import AIFeatureGate from "./AIFeatureGate.tsx";

// AI research verdict (convex/ai.ts researchProduct): test / research more /
// skip from the evidence AdSpy has, every point labelled by where it comes
// from, the margin maths done in code, and one next step. Saved per product.

const CALL = {
  test: { title: "Test it", note: "Worth a controlled real-world test, not a proven winner.", style: "border-good/40 bg-good/10 text-good" },
  research: { title: "Research more", note: "The evidence is too thin or mixed to spend money yet.", style: "border-warn/40 bg-warn/10 text-warn" },
  skip: { title: "Skip", note: "The evidence shows a hard blocker.", style: "border-bad/40 bg-bad/10 text-bad" },
} as const;

const LABEL: Record<EvidenceLabel, { text: string; style: string }> = {
  adspy: { text: "AdSpy data", style: "bg-primary/10 text-primary" },
  assumption: { text: "assumption", style: "bg-muted text-muted-foreground" },
  verify: { text: "check this", style: "bg-warn/15 text-warn" },
};

const usd = (n: number) => `$${n.toFixed(2)}`;

// Where on the product page each next step can be started (ids set in products/[id].tsx).
const NEXT_STEP: Partial<Record<ResearchReport["nextTask"], { target: string; label: string; needsSuppliers?: boolean }>> = {
  "product review analysis": { target: "suppliers", label: "Open the supplier listings", needsSuppliers: true },
  "supplier vetting": { target: "suppliers", label: "Compare the suppliers", needsSuppliers: true },
  "competitor analysis": { target: "competitors", label: "Find competitors" },
  "pricing and margin analysis": { target: "profit-calculator", label: "Check your own numbers" },
  "product validation": { target: "demand", label: "See the demand signals" },
};

/** Scrolls to a section of the product page and briefly outlines it. */
function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.add("ring-2", "ring-primary", "rounded-xl");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "rounded-xl"), 1800);
}

function Section({ icon: Icon, title, children }: { icon: typeof Lightbulb; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ResearchVerdictCard({ productId, hasSuppliers }: { productId: Id<"products">; hasSuppliers: boolean }) {
  const saved = useQuery(api.researchReports.latest, { productId });
  const research = useAction(api.ai.researchProduct);
  const [busy, setBusy] = useState(false);
  const report = saved?.report as ResearchReport | undefined;
  const margin = saved?.margin as Margin | null | undefined;
  const reviews = saved?.reviews as ReviewSample | undefined;
  const step = report ? NEXT_STEP[report.nextTask] : undefined;
  const stepLink = step && (!step.needsSuppliers || hasSuppliers) ? step : undefined;

  const run = async () => {
    setBusy(true);
    try {
      await research({ productId });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't research this product. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AIFeatureGate>
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Microscope className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">AI research verdict</h3>
          </div>
          {!report && (
            <Button size="sm" onClick={run} disabled={busy}>
              {busy ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {busy ? "Researching…" : "Research it"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Test, research more or skip, from everything AdSpy knows about it: ads, competition in your country, supplier price and its buyers' reviews.
          Every point says where it comes from, and nothing is made up.
        </p>

        {report && (
          <div className="pt-3 border-t border-border space-y-4">
            <div className={cn("rounded-lg border p-3", CALL[report.call].style)}>
              <div className="font-semibold text-sm">{CALL[report.call].title}</div>
              <p className="text-sm text-foreground mt-1">{report.bottomLine}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{CALL[report.call].note}</p>
            </div>

            {report.reasons.length > 0 && (
              <Section icon={ClipboardList} title="Why">
                <ul className="space-y-1.5">
                  {report.reasons.map((r, i) => (
                    <li key={i} className="text-xs flex gap-2 items-start">
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", LABEL[r.label].style)}>{LABEL[r.label].text}</span>
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section icon={Lightbulb} title="Money per sale">
              {margin ? (
                <div className="text-xs space-y-1">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-w-xs">
                    <span className="text-muted-foreground">Selling price</span><span>{usd(margin.price)}</span>
                    <span className="text-muted-foreground">Supplier cost (landed)</span><span>−{usd(margin.cost)}</span>
                    <span className="text-muted-foreground">Card fees (assumed)</span><span>−{usd(margin.fees)}</span>
                    <span className="font-semibold">Left for ads</span><span className="font-semibold">{usd(margin.profit)} ({margin.profitPct}%)</span>
                  </div>
                  <p className="text-muted-foreground">
                    So each sale may cost at most <strong className="text-foreground">{usd(margin.breakEvenAdCost)}</strong> in ads before you lose money. Fees assumed at{" "}
                    {(FEE_PCT * 100).toFixed(1)}% + ${FEE_FIXED.toFixed(2)}; not counted: refunds, discounts, VAT, chargebacks, apps.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Can't be worked out yet: the selling price or supplier cost is missing. Add them in the profit calculator above to check your own numbers.</p>
              )}
            </Section>

            {reviews && (
              <p className="text-xs text-muted-foreground">
                Supplier listing: {reviews.average}★ from {reviews.total} reviews ({reviews.stars[0]} × 5★, {reviews.stars[2] + reviews.stars[3] + reviews.stars[4]} × 3★ or lower). A first page of reviews, not a full analysis.
              </p>
            )}

            {report.risks.length > 0 && (
              <Section icon={AlertTriangle} title="Risks">
                <ul className="space-y-1">
                  {report.risks.map((r, i) => (
                    <li key={i} className="text-xs flex gap-2 items-start">
                      {r.blocker && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-bad/15 text-bad">blocker</span>}
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {report.fixes.length > 0 && (
              <Section icon={Lightbulb} title="Ideas to test">
                <ul className="space-y-1 list-disc pl-4 text-xs">{report.fixes.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </Section>
            )}

            {report.missing.length > 0 && (
              <Section icon={ClipboardList} title="Still missing">
                <ul className="space-y-1 list-disc pl-4 text-xs text-muted-foreground">{report.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </Section>
            )}

            {report.checklist.length > 0 && (
              <Section icon={ClipboardList} title="Check next, most important first">
                <ol className="space-y-1 list-decimal pl-4 text-xs">{report.checklist.map((c, i) => <li key={i}>{c}</li>)}</ol>
              </Section>
            )}

            <div className="rounded-lg bg-muted/50 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <ArrowRight className="w-3.5 h-3.5" /> Next step: {report.nextTask.charAt(0).toUpperCase() + report.nextTask.slice(1)}
              </div>
              {report.nextTaskWhy}
              {stepLink && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => goTo(stepLink.target)}>
                  {stepLink.label}
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">{saved?.createdAt ? `Researched ${new Date(saved.createdAt).toLocaleDateString()}. Prices, ads and reviews change: research again before you spend.` : ""}</span>
              <Button size="sm" variant="secondary" onClick={run} disabled={busy}>
                {busy ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                {busy ? "Researching…" : "Research again"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AIFeatureGate>
  );
}
