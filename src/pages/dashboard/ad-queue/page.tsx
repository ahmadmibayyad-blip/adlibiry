import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, ClipboardCheck, Copy, Download, Pencil, Sparkles, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Ad queue (convex/adQueue.ts): Launch's ads and their AI variations wait here for Approve, Edit or Reject.
// Approved ads are ready to copy into Meta or TikTok; nothing is posted from here.

type Ad = NonNullable<FunctionReturnType<typeof api.adQueue.mine>>["ads"][number];
const TABS = [
  { id: "pending", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
] as const;

export default function AdQueuePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("pending");
  const data = useQuery(api.adQueue.mine, { status: tab });
  const importLaunches = useMutation(api.adQueue.importLaunches);
  const imported = useRef(false);

  useEffect(() => {
    if (imported.current) return;
    imported.current = true;
    void importLaunches({}).catch(() => {});
  }, [importLaunches]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="w-6 h-6 text-primary" /> Ad queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every ad AdSpy writes for your launches waits here. Approve the good ones, fix or reject the rest, and make variations of winners. Approved ads are ready to copy
          into Meta or TikTok.
        </p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn("px-3 py-2 text-sm border-b-2 -mb-px transition", tab === t.id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}{data ? ` (${data.counts[t.id]})` : ""}
          </button>
        ))}
      </div>
      {data === undefined ? <Spinner className="w-5 h-5" /> : !data ? null : data.ads.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.ads.map((a) => <AdCard key={a._id} ad={a} />)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tab === "pending" ? (
            <>Nothing to review. Ads appear here when a <Link to="/dashboard/launch" className="text-primary hover:underline">launch</Link> is published.</>
          ) : tab === "approved" ? "No approved ads yet." : "No rejected ads."}
        </p>
      )}
    </div>
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const decide = useMutation(api.adQueue.decide);
  const edit = useMutation(api.adQueue.edit);
  const variations = useAction(api.adQueueAi.variations);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ hook: ad.hook, primaryText: ad.primaryText, headline: ad.headline });
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e, "That didn't work"));
    } finally {
      setBusy(null);
    }
  };
  const text = `${ad.hook}\n\n${ad.primaryText}`;

  return (
    <li className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      {ad.imageUrl ? <img src={ad.imageUrl} alt="" className="w-full aspect-square object-cover" loading="lazy" /> : null}
      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">{ad.angle}</span>
          {ad.source === "variation" ? <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">AI variation</span> : null}
          <span className="text-muted-foreground truncate">{ad.productTitle}</span>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder="Hook (first line)" />
            <textarea value={form.primaryText} onChange={(e) => setForm({ ...form, primaryText: e.target.value })} rows={5} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="Headline" />
            <div className="flex gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => void run("save", () => edit({ id: ad._id, ...form }).then(() => setEditing(false)), "Saved")}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setForm({ hook: ad.hook, primaryText: ad.primaryText, headline: ad.headline }); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 flex-1">
            <p className="font-semibold text-sm">{ad.hook}</p>
            <p className="text-sm whitespace-pre-line">{ad.primaryText}</p>
            <p className="text-xs text-muted-foreground">Headline: {ad.headline}</p>
          </div>
        )}
        {!editing ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ad.status === "pending" ? (
              <>
                <Button size="sm" disabled={!!busy} onClick={() => void run("ok", () => decide({ id: ad._id, status: "approved" }), "Approved")}><Check className="w-4 h-4 mr-1" /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("no", () => decide({ id: ad._id, status: "rejected" }))}><X className="w-4 h-4 mr-1" /> Reject</Button>
              </>
            ) : ad.status === "approved" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Ad text copied"))}><Copy className="w-4 h-4 mr-1" /> Copy text</Button>
                {ad.imageUrl ? (
                  <Button size="sm" variant="outline" asChild>
                    <a href={ad.imageUrl} download target="_blank" rel="noreferrer"><Download className="w-4 h-4 mr-1" /> Image</a>
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("var", () => variations({ id: ad._id }), "3 variations added to To review")}>
                  {busy === "var" ? <Spinner className="w-4 h-4 mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />} Make variations
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("back", () => decide({ id: ad._id, status: "pending" }))}><Undo2 className="w-4 h-4 mr-1" /> Back to review</Button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}
