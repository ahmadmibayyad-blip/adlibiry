import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BookOpen, Calculator, CheckCircle2, Circle, Clock, ExternalLink, Lightbulb, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { useKnowledge } from "@/hooks/use-knowledge.ts";
import { TOPIC_ICONS } from "@/lib/knowledgeIcons.ts";
import { cn } from "@/lib/utils.ts";
import KnowledgeLoading from "./_components/KnowledgeLoading.tsx";
import LevelTag from "./_components/LevelTag.tsx";

// A topic: its guides in a rail on the left (ticked when read), the open guide
// on the right with its steps, mistakes, tip and sources, mark as read and the
// next guide. One column on phones.

export default function KnowledgeTopic() {
  const { topicId, guideId } = useParams<{ topicId: string; guideId?: string }>();
  const reads = useQuery(api.knowledge.myReads);
  const read = useMemo(() => new Set(reads ?? []), [reads]);
  const toggle = useMutation(api.knowledge.toggleRead);
  const k = useKnowledge();

  if (!k) return <KnowledgeLoading />;
  const topic = k.topics.find((t) => t.id === topicId);
  if (!topic || !topic.guides.length) return <Navigate to="/dashboard/knowledge" replace />;
  const guide = topic.guides.find((g) => g.id === guideId) ?? topic.guides[0];
  const next = k.nextGuide(topic.id, guide.id);
  const isRead = read.has(guide.id);
  const Icon = TOPIC_ICONS[topic.icon] ?? BookOpen;

  const markRead = async () => {
    try {
      const now = await toggle({ guideId: guide.id });
      if (now) toast.success("Marked as read");
    } catch {
      toast.error("Couldn't save that. Please try again.");
    }
  };

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <Link to="/dashboard/knowledge" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft className="w-4 h-4" /> All topics
      </Link>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        <aside className="lg:sticky lg:top-6 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{topic.stage}</div>
              <div className="font-semibold leading-tight">{topic.name}</div>
            </div>
          </div>
          <ol className="space-y-0.5">
            {topic.guides.map((g) => {
              const active = g.id === guide.id;
              return (
                <li key={g.id}>
                  <Link
                    to={`/dashboard/knowledge/${topic.id}/${g.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                      active ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary",
                    )}
                  >
                    {read.has(g.id) ? (
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-good" aria-label="Read" />
                    ) : (
                      <Circle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>{g.title}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </aside>

        <article className="bg-card border border-border rounded-xl p-5 sm:p-7 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <LevelTag level={guide.level} />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {guide.mins} min read
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold leading-tight mb-2">{guide.title}</h1>
          <p className="text-muted-foreground mb-6">{guide.summary}</p>

          <h2 className="font-semibold mb-2">Key steps</h2>
          <ol className="space-y-2.5 mb-6">
            {guide.points.map((p, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>

          <h2 className="font-semibold mb-2">Common mistakes</h2>
          <ul className="space-y-2 mb-6">
            {guide.mistakes.map((m, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <X className="w-4 h-4 mt-0.5 shrink-0 text-bad" aria-hidden="true" />
                <span>{m}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-6">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-primary mb-1">
              <Lightbulb className="w-4 h-4" /> Pro tip
            </div>
            <p className="text-sm">{guide.tip}</p>
          </div>

          {topic.id === "pricing" && (
            <Link
              to="/dashboard/knowledge/tools/calculator"
              className="flex items-center gap-3 rounded-xl border border-border p-4 mb-6 hover:border-primary/40 transition-colors"
            >
              <Calculator className="w-5 h-5 text-primary shrink-0" />
              <span className="text-sm">
                <span className="font-semibold">Open the break-even calculator</span>
                <span className="block text-muted-foreground text-xs">Work out the CPA and ROAS you can afford for your product.</span>
              </span>
            </Link>
          )}

          {guide.sources.length > 0 && (
            <>
              <h2 className="font-semibold mb-2">Sources</h2>
              <ul className="space-y-1.5 mb-6">
                {guide.sources.map((s) => (
                  <li key={s.u}>
                    <a href={s.u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                      {s.t} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-border">
            <Button variant={isRead ? "secondary" : "default"} onClick={markRead} disabled={reads === undefined}>
              {isRead ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Circle className="w-4 h-4 mr-2" />}
              {isRead ? "Read" : "Mark as read"}
            </Button>
            {next && (
              <Button asChild variant="outline" className="max-w-full">
                <Link to={`/dashboard/knowledge/${next.topic.id}/${next.guide.id}`}>
                  <span className="truncate">Next: {next.guide.title}</span>
                  <ArrowRight className="w-4 h-4 ml-2 shrink-0" />
                </Link>
              </Button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
