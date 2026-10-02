import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Bot, Play, Plus, Trash2, Pause, Clock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { NICHES } from "@/convex/lib/category.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { linkify } from "@/lib/linkify.tsx";
import { cn } from "@/lib/utils.ts";

// AI Agents: standing research goals Claude works on every morning
// (convex/agents.ts, convex/agentRunner.ts).

const TEMPLATES = [
  { name: "Daily winners", goal: "Every morning, find the 5 best new winning products in my niches: score 75+, a known price, and ads running. Say why each one could sell." },
  { name: "Scaling ads", goal: "Find ads in my niches that have been running 14+ days with high views or likes — a sign they are profitable. Tell me what product they sell and the hook they use." },
  { name: "Cheap & low competition", goal: "Find products under $30 with a margin of 40%+ and few ads running, so a beginner can test them with a small budget." },
];

const errorText = (e: unknown, fallback: string) =>
  e instanceof ConvexError && typeof (e.data as { message?: unknown })?.message === "string" ? (e.data as { message: string }).message : fallback;

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function NichePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NICHES.map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n].slice(0, 6))}
            className={cn(
              "px-2.5 h-7 rounded-full text-xs border cursor-pointer transition-colors",
              on ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function NewAgent({ onDone }: { onDone: () => void }) {
  const create = useMutation(api.agents.create);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [niches, setNiches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await create({ name, goal, niches });
      toast.success("Agent created. It writes its first briefing tomorrow morning, or click Run now.");
      onDone();
    } catch (e) {
      toast.error(errorText(e, "Couldn't create the agent"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <div className="text-sm font-semibold mb-2">Start from a template</div>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setName(t.name);
                setGoal(t.goal);
              }}
              className="text-xs px-3 h-8 rounded-full border border-border bg-muted/50 hover:border-primary/40 cursor-pointer"
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name, e.g. Pet scout" maxLength={60} />
      <Textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="What should it look for every day? e.g. Find rising pet products under $40 with ads running 7+ days."
        rows={3}
        maxLength={1000}
      />
      <div>
        <div className="text-xs text-muted-foreground mb-1.5">Focus niches (optional)</div>
        <NichePicker value={niches} onChange={setNiches} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || goal.trim().length < 10}>
          {saving ? <Spinner /> : <Plus className="w-4 h-4 mr-1" />}
          Create agent
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: Doc<"agents"> & { latest: Doc<"agentBriefings"> | null } }) {
  const update = useMutation(api.agents.update);
  const remove = useMutation(api.agents.remove);
  const runNow = useAction(api.agentRunner.runNow);
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery(api.agents.briefings, showHistory ? { agentId: agent._id as Id<"agents"> } : "skip");

  const run = async () => {
    setRunning(true);
    try {
      const r = await runNow({ agentId: agent._id });
      if (r.status === "ok") toast.success("New briefing ready");
      else toast.error(r.text);
    } catch (e) {
      toast.error(errorText(e, "The agent couldn't run"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">{agent.name}</h3>
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full", agent.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {agent.enabled ? "Runs every morning" : "Paused"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{agent.goal}</p>
          {agent.niches.length > 0 && <p className="text-xs text-muted-foreground mt-1">Niches: {agent.niches.join(", ")}</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={run} disabled={running}>
            {running ? <Spinner /> : <Play className="w-3.5 h-3.5 mr-1" />}
            {running ? "Working…" : "Run now"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => update({ id: agent._id, name: agent.name, goal: agent.goal, niches: agent.niches, enabled: !agent.enabled })}
            title={agent.enabled ? "Pause the daily run" : "Resume the daily run"}
          >
            {agent.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm(`Delete "${agent.name}" and its briefings?`)) void remove({ id: agent._id });
            }}
            title="Delete agent"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-muted/50 border border-border p-4">
        {agent.latest ? (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <Clock className="w-3 h-3" />
              Briefing · {when(agent.latest.createdAt)}
            </div>
            <div className={cn("text-sm whitespace-pre-wrap leading-relaxed", agent.latest.status !== "ok" && "text-destructive")}>
              {linkify(agent.latest.text.replace(/\*\*/g, ""))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No briefing yet. The first one arrives tomorrow morning, or click Run now.</p>
        )}
      </div>

      <button type="button" onClick={() => setShowHistory((s) => !s)} className="mt-3 text-xs text-primary hover:underline cursor-pointer">
        {showHistory ? "Hide earlier briefings" : "Earlier briefings"}
      </button>
      {showHistory && (
        <div className="mt-2 space-y-3">
          {history === undefined ? (
            <Spinner />
          ) : (
            history.slice(1).map((b) => (
              <div key={b._id} className="text-xs border-l-2 border-border pl-3">
                <div className="text-muted-foreground mb-1">{when(b.createdAt)}</div>
                <div className="whitespace-pre-wrap">{linkify(b.text.replace(/\*\*/g, ""))}</div>
              </div>
            ))
          )}
          {history && history.length <= 1 && <p className="text-xs text-muted-foreground">No earlier briefings.</p>}
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const agents = useQuery(api.agents.list, {});
  const [adding, setAdding] = useState(false);
  return (
    <div className="p-5 lg:p-8 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Bot className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">AI Agents</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Give an agent a research goal once. Every morning, after the data update, it searches AdSpy Pro's products and ads and
            writes you a short briefing with picks and a next step.
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New agent
          </Button>
        )}
      </div>

      {adding && <NewAgent onDone={() => setAdding(false)} />}

      {agents === undefined ? (
        <Spinner />
      ) : agents.length === 0 && !adding ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">No agents yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create one from a template to get a daily briefing.</p>
          <Button onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New agent
          </Button>
        </div>
      ) : (
        agents.map((a) => <AgentCard key={a._id} agent={a} />)
      )}
    </div>
  );
}
