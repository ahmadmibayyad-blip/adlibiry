import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowUp, BookOpen, BookText, ExternalLink, Plus, RotateCcw, Save, Trash2, Undo2,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { LEVELS, SLUG, STAGES, contentProblems } from "@/convex/lib/knowledge.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { BUILT_IN, type Content, type Guide, type Topic } from "@/lib/knowledge.ts";
import { TOPIC_ICONS } from "@/lib/knowledgeIcons.ts";
import { cn } from "@/lib/utils.ts";

// Admin → Knowledge: edit, add, delete and reorder the topics, guides and
// glossary. Changes stay in this browser until "Save changes", which replaces
// the guides everyone sees (convex/knowledge.ts saveContent). "Restore the
// built-in guides" goes back to src/data/knowledge.json.

type Saved = { reviewed: string; topics: Topic[]; glossary: string[][]; updatedAt: string } | null;
type Selection = { kind: "topic"; t: number } | { kind: "guide"; t: number; g: number } | { kind: "glossary" };
type State = { draft: Content; original: Content; base: string | null };

const contentOf = (c: Content): Content => structuredClone({ reviewed: c.reviewed, topics: c.topics, glossary: c.glossary });
const initial = (saved: Saved): State => {
  const original = contentOf(saved ?? BUILT_IN);
  return { draft: structuredClone(original), original, base: saved?.updatedAt ?? null };
};

/** Trims text and drops blank steps, mistakes and sources: what gets checked and saved. */
function clean(c: Content): Content {
  const lines = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    reviewed: c.reviewed,
    topics: c.topics.map((t) => ({
      ...t,
      name: t.name.trim(),
      blurb: t.blurb.trim(),
      guides: t.guides.map((g) => ({
        ...g,
        title: g.title.trim(),
        summary: g.summary.trim(),
        tip: g.tip.trim(),
        points: lines(g.points),
        mistakes: lines(g.mistakes),
        sources: g.sources.map((s) => ({ t: s.t.trim(), u: s.u.trim() })).filter((s) => s.t || s.u),
      })),
    })),
    glossary: c.glossary.map((p) => p.map((x) => x.trim())).filter((p) => p.some(Boolean)),
  };
}

function slugify(text: string, taken: Set<string>): string {
  const base = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function moved<T>(xs: T[], i: number, to: number): T[] {
  const out = [...xs];
  const [x] = out.splice(i, 1);
  out.splice(to, 0, x);
  return out;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof ConvexError ? ((err.data as { message?: string })?.message ?? fallback) : fallback;

export default function KnowledgeEditor() {
  const saved = useQuery(api.knowledge.content) as Saved | undefined;
  const save = useMutation(api.knowledge.saveContent);
  const reset = useMutation(api.knowledge.resetContent);
  const [state, setState] = useState<State | null>(null);
  const [sel, setSel] = useState<Selection>({ kind: "guide", t: 0, g: 0 });
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const live = saved === undefined ? undefined : (saved?.updatedAt ?? null);
  // Load the guides once; afterwards pick up another admin's save only while nothing here is unsaved.
  const dirty = state ? JSON.stringify(clean(state.draft)) !== JSON.stringify(clean(state.original)) : false;
  if (saved !== undefined && (state === null || (!dirty && !busy && live !== state.base))) {
    setState(initial(saved));
  }
  if (!state) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  const { draft, original } = state;
  const problems = contentProblems(clean(draft));
  const conflict = !busy && live !== undefined && live !== state.base;
  const originalGuideIds = new Set(original.topics.flatMap((t) => t.guides.map((g) => g.id)));
  const originalTopicIds = new Set(original.topics.map((t) => t.id));
  const guideIds = new Set(draft.topics.flatMap((t) => t.guides.map((g) => g.id)));

  const setDraft = (fn: (d: Content) => Content) => setState((s) => (s ? { ...s, draft: fn(s.draft) } : s));
  const setTopics = (fn: (ts: Topic[]) => Topic[]) => setDraft((d) => ({ ...d, topics: fn(d.topics) }));
  const setTopic = (t: number, patch: Partial<Topic>) => setTopics((ts) => ts.map((x, i) => (i === t ? { ...x, ...patch } : x)));
  const setGuide = (t: number, g: number, patch: Partial<Guide>) =>
    setTopics((ts) => ts.map((x, i) => (i === t ? { ...x, guides: x.guides.map((y, j) => (j === g ? { ...y, ...patch } : y)) } : x)));

  const addGuide = (t: number) => {
    const guide: Guide = {
      id: slugify("new guide", guideIds), title: "New guide", level: "Beginner", mins: 3,
      summary: "", points: [""], mistakes: [], tip: "", sources: [],
    };
    setTopics((ts) => ts.map((x, i) => (i === t ? { ...x, guides: [...x.guides, guide] } : x)));
    setSel({ kind: "guide", t, g: draft.topics[t].guides.length });
  };
  const addTopic = () => {
    const topic: Topic = {
      id: slugify("new topic", new Set(draft.topics.map((x) => x.id))), name: "New topic", icon: "compass", stage: "Foundations", blurb: "",
      guides: [{ id: slugify("new guide", guideIds), title: "New guide", level: "Beginner", mins: 3, summary: "", points: [""], mistakes: [], tip: "", sources: [] }],
    };
    setTopics((ts) => [...ts, topic]);
    setSel({ kind: "topic", t: draft.topics.length });
  };
  const deleteGuide = (t: number, g: number) => {
    setTopics((ts) => ts.map((x, i) => (i === t ? { ...x, guides: x.guides.filter((_, j) => j !== g) } : x)));
    setSel({ kind: "topic", t });
  };
  const deleteTopic = (t: number) => {
    setTopics((ts) => ts.filter((_, i) => i !== t));
    setSel({ kind: "glossary" });
  };
  const moveTopic = (t: number, to: number) => {
    setTopics((ts) => moved(ts, t, to));
    setSel({ kind: "topic", t: to });
  };
  const moveGuide = (t: number, g: number, to: number) => {
    setTopics((ts) => ts.map((x, i) => (i === t ? { ...x, guides: moved(x.guides, g, to) } : x)));
    setSel({ kind: "guide", t, g: to });
  };
  const moveGuideToTopic = (t: number, g: number, to: number) => {
    const guide = draft.topics[t].guides[g];
    setTopics((ts) =>
      ts.map((x, i) =>
        i === t ? { ...x, guides: x.guides.filter((_, j) => j !== g) } : i === to ? { ...x, guides: [...x.guides, guide] } : x,
      ),
    );
    setSel({ kind: "guide", t: to, g: draft.topics[to].guides.length });
  };

  const onSave = async () => {
    const c = clean(draft);
    setBusy(true);
    try {
      const updatedAt = await save({ ...c, baseUpdatedAt: state.base });
      setState({ draft: structuredClone(c), original: structuredClone(c), base: updatedAt });
      toast.success("Guides saved. Everyone sees the new version now.");
    } catch (err) {
      toast.error(errorText(err, "Couldn't save the guides. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  const onReset = async () => {
    setBusy(true);
    try {
      await reset({});
      setState(initial(null));
      setSel({ kind: "guide", t: 0, g: 0 });
      toast.success("Back to the built-in guides.");
    } catch (err) {
      toast.error(errorText(err, "Couldn't restore the guides. Please try again."));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  const topic = sel.kind !== "glossary" ? draft.topics[sel.t] : undefined;
  const guide = sel.kind === "guide" ? topic?.guides[sel.g] : undefined;
  const guideCount = draft.topics.reduce((n, t) => n + t.guides.length, 0);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {draft.topics.length} topics · {guideCount} guides · {draft.glossary.length} glossary terms
          </div>
          <div className="text-xs text-muted-foreground">
            {state.base
              ? `Edited version, last saved ${new Date(state.base).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.`
              : "Showing the built-in guides."}{" "}
            {dirty ? <span className="text-warn font-medium">You have unsaved changes.</span> : "No unsaved changes."}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Reviewed on
          <Input
            type="date"
            value={draft.reviewed}
            onChange={(e) => setDraft((d) => ({ ...d, reviewed: e.target.value }))}
            className="h-8 w-36 text-xs"
          />
        </label>
        <Button variant="ghost" size="sm" asChild>
          <a href="/dashboard/knowledge" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> View
          </a>
        </Button>
        {state.base && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={busy}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore built-in
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setState({ ...state, draft: structuredClone(original) })} disabled={!dirty || busy}>
          <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={!dirty || busy || problems.length > 0 || conflict}>
          {busy ? <Spinner className="mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />} Save changes
        </Button>
      </div>

      {conflict && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0" />
          <span className="flex-1 min-w-0">Another admin saved the guides while you were editing. Load their version to continue; your unsaved changes here will be lost.</span>
          <Button size="sm" variant="outline" onClick={() => setState(initial(saved ?? null))}>
            Load their version
          </Button>
        </div>
      )}

      {dirty && problems.length > 0 && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
          <div className="font-semibold mb-1">Fix {problems.length === 1 ? "this" : `these ${problems.length} things`} before saving:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {problems.length > 6 && <div className="mt-1">…and {problems.length - 6} more.</div>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        <nav aria-label="Topics and guides" className="bg-card border border-border rounded-xl p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] overflow-y-auto">
          {draft.topics.map((t, ti) => {
            const Icon = TOPIC_ICONS[t.icon] ?? BookOpen;
            return (
              <div key={ti} className="mb-1">
                <OutlineRow
                  active={sel.kind === "topic" && sel.t === ti}
                  onSelect={() => setSel({ kind: "topic", t: ti })}
                  onUp={ti > 0 ? () => moveTopic(ti, ti - 1) : undefined}
                  onDown={ti < draft.topics.length - 1 ? () => moveTopic(ti, ti + 1) : undefined}
                  label={t.name || "Untitled topic"}
                  className="font-semibold"
                  icon={<Icon className="w-3.5 h-3.5 text-primary shrink-0" />}
                />
                <div className="pl-4">
                  {t.guides.map((g, gi) => (
                    <OutlineRow
                      key={gi}
                      active={sel.kind === "guide" && sel.t === ti && sel.g === gi}
                      onSelect={() => setSel({ kind: "guide", t: ti, g: gi })}
                      onUp={gi > 0 ? () => moveGuide(ti, gi, gi - 1) : undefined}
                      onDown={gi < t.guides.length - 1 ? () => moveGuide(ti, gi, gi + 1) : undefined}
                      label={g.title || "Untitled guide"}
                    />
                  ))}
                  <button
                    onClick={() => addGuide(ti)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-primary cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add guide
                  </button>
                </div>
              </div>
            );
          })}
          <div className="border-t border-border mt-2 pt-2 space-y-0.5">
            <button onClick={addTopic} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-primary cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add topic
            </button>
            <OutlineRow
              active={sel.kind === "glossary"}
              onSelect={() => setSel({ kind: "glossary" })}
              label={`Glossary (${draft.glossary.length})`}
              icon={<BookText className="w-3.5 h-3.5 text-primary shrink-0" />}
            />
          </div>
        </nav>

        <div className="bg-card border border-border rounded-xl p-5 min-w-0">
          {sel.kind === "glossary" ? (
            <GlossaryForm glossary={draft.glossary} onChange={(glossary) => setDraft((d) => ({ ...d, glossary }))} />
          ) : guide && sel.kind === "guide" ? (
            <GuideForm
              key={`${sel.t}-${sel.g}`}
              guide={guide}
              idEditable={!originalGuideIds.has(guide.id)}
              takenIds={new Set(draft.topics.flatMap((t) => t.guides.map((g) => g.id)).filter((id, i, all) => id !== guide.id || all.indexOf(id) !== i))}
              topics={draft.topics}
              topicIndex={sel.t}
              onChange={(patch) => setGuide(sel.t, sel.g, patch)}
              onMoveToTopic={(to) => moveGuideToTopic(sel.t, sel.g, to)}
              onDelete={() => deleteGuide(sel.t, sel.g)}
            />
          ) : topic && sel.kind === "topic" ? (
            <TopicForm
              key={sel.t}
              topic={topic}
              idEditable={!originalTopicIds.has(topic.id)}
              takenIds={new Set(draft.topics.map((t) => t.id).filter((id, i, all) => id !== topic.id || all.indexOf(id) !== i))}
              onChange={(patch) => setTopic(sel.t, patch)}
              onDelete={() => deleteTopic(sel.t)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Pick a topic or guide on the left.</p>
          )}
        </div>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the built-in guides?</AlertDialogTitle>
            <AlertDialogDescription>
              Every edit saved here is thrown away and everyone sees the guides that ship with the app again. Read progress is kept for guides that
              still exist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onReset}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OutlineRow({
  label, active, onSelect, onUp, onDown, icon, className,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  onUp?: () => void;
  onDown?: () => void;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("group flex items-center gap-1 rounded-md", active ? "bg-primary/10 text-primary" : "hover:bg-secondary")}>
      <button onClick={onSelect} aria-current={active ? "true" : undefined} className={cn("flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm cursor-pointer", className)}>
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {(onUp || onDown) && (
        <span className="flex shrink-0 pr-1 opacity-60 group-hover:opacity-100">
          <button onClick={onUp} disabled={!onUp} aria-label={`Move ${label} up`} className="p-1 rounded hover:bg-background disabled:opacity-30 cursor-pointer disabled:cursor-default">
            <ArrowUp className="w-3 h-3" />
          </button>
          <button onClick={onDown} disabled={!onDown} aria-label={`Move ${label} down`} className="p-1 rounded hover:bg-background disabled:opacity-30 cursor-pointer disabled:cursor-default">
            <ArrowDown className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function IdField({ value, editable, onChange, path }: { value: string; editable: boolean; onChange: (id: string) => void; path: string }) {
  return editable ? (
    <Field label="Link name" hint="Lowercase letters, numbers and dashes. Can't be changed after saving.">
      <Input value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-invalid={!SLUG.test(value)} />
    </Field>
  ) : (
    <p className="text-xs text-muted-foreground">
      Link: <code className="text-foreground">{path}</code> (fixed, so read progress and shared links keep working)
    </p>
  );
}

function TopicForm({
  topic, idEditable, takenIds, onChange, onDelete,
}: {
  topic: Topic;
  idEditable: boolean;
  takenIds: Set<string>;
  onChange: (p: Partial<Topic>) => void;
  onDelete: () => void;
}) {
  // A new topic's link name follows its name until it's edited by hand.
  const autoId = idEditable && topic.id === slugify(topic.name, takenIds);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Topic</h2>
        <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete topic and its {topic.guides.length} guides
        </Button>
      </div>
      <Field label="Name">
        <Input
          value={topic.name}
          onChange={(e) => onChange(autoId ? { name: e.target.value, id: slugify(e.target.value, takenIds) } : { name: e.target.value })}
        />
      </Field>
      <IdField value={topic.id} editable={idEditable} onChange={(id) => onChange({ id })} path={`/dashboard/knowledge/${topic.id}`} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage">
          <Select value={topic.stage} onValueChange={(stage) => onChange({ stage: stage as Topic["stage"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Icon">
          <Select value={topic.icon} onValueChange={(icon) => onChange({ icon })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TOPIC_ICONS).map(([name, Icon]) => (
                <SelectItem key={name} value={name}>
                  <Icon className="w-4 h-4" /> {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Description" hint="Shown on the topic's card">
        <Textarea rows={3} value={topic.blurb} onChange={(e) => onChange({ blurb: e.target.value })} />
      </Field>
    </div>
  );
}

function GuideForm({
  guide, idEditable, takenIds, topics, topicIndex, onChange, onMoveToTopic, onDelete,
}: {
  guide: Guide;
  idEditable: boolean;
  takenIds: Set<string>;
  topics: Topic[];
  topicIndex: number;
  onChange: (p: Partial<Guide>) => void;
  onMoveToTopic: (to: number) => void;
  onDelete: () => void;
}) {
  // A new guide's link name follows its title until it's edited by hand.
  const autoId = idEditable && guide.id === slugify(guide.title, takenIds);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Guide</h2>
        <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete guide
        </Button>
      </div>
      <Field label="Title">
        <Input
          value={guide.title}
          onChange={(e) => onChange(autoId ? { title: e.target.value, id: slugify(e.target.value, takenIds) } : { title: e.target.value })}
        />
      </Field>
      <IdField
        value={guide.id}
        editable={idEditable}
        onChange={(id) => onChange({ id })}
        path={`/dashboard/knowledge/${topics[topicIndex].id}/${guide.id}`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Topic">
          <Select value={String(topicIndex)} onValueChange={(v) => onMoveToTopic(Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {topics.map((t, i) => (
                <SelectItem key={i} value={String(i)}>
                  {t.name || "Untitled topic"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Level">
          <Select value={guide.level} onValueChange={(level) => onChange({ level: level as Guide["level"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Read time" hint="minutes">
          <Input
            type="number"
            min={1}
            max={120}
            value={guide.mins}
            onChange={(e) => onChange({ mins: Math.round(Number(e.target.value) || 0) })}
          />
        </Field>
      </div>
      <Field label="Summary">
        <Textarea rows={3} value={guide.summary} onChange={(e) => onChange({ summary: e.target.value })} />
      </Field>
      <Field label="Key steps" hint="One per line">
        <Textarea rows={7} value={guide.points.join("\n")} onChange={(e) => onChange({ points: e.target.value.split("\n") })} />
      </Field>
      <Field label="Common mistakes" hint="One per line">
        <Textarea rows={4} value={guide.mistakes.join("\n")} onChange={(e) => onChange({ mistakes: e.target.value.split("\n") })} />
      </Field>
      <Field label="Pro tip">
        <Textarea rows={2} value={guide.tip} onChange={(e) => onChange({ tip: e.target.value })} />
      </Field>
      <div className="space-y-2">
        <div className="text-sm font-medium">Sources</div>
        {guide.sources.map((s, i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Title"
              aria-label={`Source ${i + 1} title`}
              value={s.t}
              onChange={(e) => onChange({ sources: guide.sources.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)) })}
              className="sm:w-56"
            />
            <div className="flex gap-2 flex-1 min-w-0">
              <Input
                placeholder="https://"
                aria-label={`Source ${i + 1} link`}
                value={s.u}
                onChange={(e) => onChange({ sources: guide.sources.map((x, j) => (j === i ? { ...x, u: e.target.value } : x)) })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove source ${i + 1}`}
                onClick={() => onChange({ sources: guide.sources.filter((_, j) => j !== i) })}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => onChange({ sources: [...guide.sources, { t: "", u: "" }] })}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add source
        </Button>
      </div>
    </div>
  );
}

function GlossaryForm({ glossary, onChange }: { glossary: string[][]; onChange: (g: string[][]) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Glossary</h2>
        <p className="text-xs text-muted-foreground">Shown A to Z on the glossary page, whatever the order here.</p>
      </div>
      {glossary.map(([term, def], i) => (
        <div key={i} className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Term"
            aria-label={`Term ${i + 1}`}
            value={term ?? ""}
            onChange={(e) => onChange(glossary.map((p, j) => (j === i ? [e.target.value, p[1] ?? ""] : p)))}
            className="sm:w-48"
          />
          <div className="flex gap-2 flex-1 min-w-0">
            <Input
              placeholder="What it means"
              aria-label={`Meaning of term ${i + 1}`}
              value={def ?? ""}
              onChange={(e) => onChange(glossary.map((p, j) => (j === i ? [p[0] ?? "", e.target.value] : p)))}
            />
            <Button variant="ghost" size="icon" aria-label={`Remove ${term || `term ${i + 1}`}`} onClick={() => onChange(glossary.filter((_, j) => j !== i))}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...glossary, ["", ""]])}>
        <Plus className="w-3.5 h-3.5 mr-1.5" /> Add term
      </Button>
    </div>
  );
}
