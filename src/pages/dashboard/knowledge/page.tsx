import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { BookOpen, BookText, Calculator, CheckCircle2, Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Input } from "@/components/ui/input.tsx";
import { STAGES, matches, type Stage } from "@/lib/knowledge.ts";
import { useKnowledge } from "@/hooks/use-knowledge.ts";
import { TOPIC_ICONS } from "@/lib/knowledgeIcons.ts";
import { cn } from "@/lib/utils.ts";
import KnowledgeLoading from "./_components/KnowledgeLoading.tsx";
import LevelTag from "./_components/LevelTag.tsx";

// Knowledge hub: the 12 topics by stage, a search across every guide, the
// user's read progress, and the calculator and glossary.

export default function KnowledgeHub() {
  const k = useKnowledge();
  const reads = useQuery(api.knowledge.myReads);
  const read = useMemo(() => new Set(reads ?? []), [reads]);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage | "All">("All");
  if (!k) return <KnowledgeLoading />;
  const { topics, allGuides } = k;
  const total = allGuides.length;
  const done = allGuides.filter((g) => read.has(g.id)).length;
  const shown = topics.filter((t) => stage === "All" || t.stage === stage);
  const results = q.trim() ? allGuides.filter((g) => (stage === "All" || g.topic.stage === stage) && matches(g, q)) : null;
  const reviewed = new Date(`${k.reviewed}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 max-w-3xl">
        <div className="text-xs font-semibold tracking-widest uppercase text-primary mb-1.5">Knowledge</div>
        <h1 className="font-display text-3xl font-bold mb-2">Learn dropshipping, step by step</h1>
        <p className="text-sm text-muted-foreground">
          Short, practical guides from your first product to scaling: how it works, the legal side in the EU, finding and testing products,
          suppliers, your store, pricing, Meta and TikTok ads, email, customer service and growth.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] items-stretch mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-sm font-semibold">Your progress</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {done} of {total} guides read
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full bg-primary rounded-full transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/dashboard/knowledge/tools/calculator" className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
            <Calculator className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Break-even calculator</span>
              <span className="block text-xs text-muted-foreground">CPA and ROAS you can afford</span>
            </span>
          </Link>
          <Link to="/dashboard/knowledge/glossary" className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
            <BookText className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Glossary</span>
              <span className="block text-xs text-muted-foreground">{k.glossary.length} terms explained</span>
            </span>
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-5">
        <div className="relative sm:max-w-sm flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all guides" className="pl-9" aria-label="Search all guides" />
        </div>
        <div role="tablist" aria-label="Stage" className="inline-flex rounded-lg border border-border bg-muted/50 p-1 max-w-full overflow-x-auto">
          {(["All", ...STAGES] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={stage === s}
              onClick={() => setStage(s)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md whitespace-nowrap cursor-pointer transition-colors",
                stage === s ? "bg-card shadow-sm font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {results ? (
        results.length ? (
          <ul className="space-y-2">
            {results.map((g) => (
              <li key={g.id}>
                <Link
                  to={`/dashboard/knowledge/${g.topic.id}/${g.id}`}
                  className="block bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">{g.topic.name}</span>
                    <LevelTag level={g.level} />
                    {read.has(g.id) && <CheckCircle2 className="w-4 h-4 text-good" aria-label="Read" />}
                  </div>
                  <div className="font-semibold text-sm">{g.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{g.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <h3 className="font-semibold mb-1">No guides match "{q.trim()}"</h3>
            <p className="text-sm text-muted-foreground">Try a shorter word, or pick "All" stages.</p>
          </div>
        )
      ) : (
        // Keyed by stage so the cards fan out again when the stage changes.
        <div key={stage} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown.map((t, i) => {
            const Icon = TOPIC_ICONS[t.icon] ?? BookOpen;
            const n = t.guides.filter((g) => read.has(g.id)).length;
            return (
              <Link
                key={t.id}
                to={`/dashboard/knowledge/${t.id}`}
                style={{ "--i": i } as React.CSSProperties}
                className="k-fan group flex flex-col bg-card border border-border rounded-2xl p-5 hover:border-primary/40 hover:shadow-md transition-[border-color,box-shadow]"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{t.stage}</span>
                </div>
                <h2 className="font-semibold group-hover:text-primary transition-colors">{t.name}</h2>
                <p className="text-sm text-muted-foreground mt-1 flex-1">{t.blurb}</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(n / t.guides.length) * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {n}/{t.guides.length} read
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <footer className="mt-10 pt-5 border-t border-border text-xs text-muted-foreground">
        Guides written for AdSpy Pro and reviewed {reviewed}. Each guide links its sources; further reading comes from{" "}
        <a href="https://dodropshipping.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          Do Dropshipping
        </a>
        . Rules on VAT, product safety and ads change: check the official source before you rely on them.
      </footer>
    </div>
  );
}
