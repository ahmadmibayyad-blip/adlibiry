import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bookmark, BookmarkCheck, ExternalLink, Palette, Puzzle, Radar, Radio, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import type { Inspection } from "@/convex/lib/storeInspect.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import StoreTeardown from "./StoreTeardown.tsx";
import StoreAnalysisCard from "./StoreAnalysisCard.tsx";
import type { StoreAnalysis } from "@/convex/lib/storeAnalysis.ts";

// Store Inspector (convex/storeInspector.ts): paste a Shopify store's link and
// see its theme, apps, ad pixels and a teardown of its main product page; then add it to the watchlist.

type Shown = { id: Id<"storeInspections">; host: string; result: Inspection };

function Result({ shown, tracked, analysis, onClose }: { shown: Shown; tracked: boolean; analysis: StoreAnalysis | null; onClose: () => void }) {
  const track = useMutation(api.storeInspector.track);
  const [busy, setBusy] = useState(false);
  const { result: r, host } = shown;
  const theme = r.theme;
  return (
    <div className="rounded-xl border border-border bg-background/50 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline inline-flex items-center gap-1">
            {r.shopName || host} <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
          <div className="text-xs text-muted-foreground">
            {host}
            {r.country ? ` · ${r.country}` : ""}
            {r.currency ? ` · ${r.currency}` : ""}
            {r.locale ? ` · ${r.locale}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={tracked ? "secondary" : "default"}
            disabled={busy || tracked}
            onClick={async () => {
              setBusy(true);
              try {
                await track({ inspectionId: shown.id });
                toast.success(`${r.shopName || host} is on your watchlist`);
              } catch (err) {
                toast.error(errorMessage(err, "Couldn't add the store"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {tracked ? <BookmarkCheck className="w-4 h-4 mr-2" /> : <Bookmark className="w-4 h-4 mr-2" />}
            {tracked ? "On your watchlist" : "Track this store"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close this inspection" title="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" />Theme</h4>
          {theme ? (
            <div className="space-y-1 text-sm">
              <div className="font-medium">
                {theme.url ? (
                  <a href={theme.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{theme.schemaName ?? theme.name}</a>
                ) : (
                  theme.schemaName ?? theme.name
                )}
                {theme.version ? <span className="text-muted-foreground font-normal"> v{theme.version}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {theme.vendor ? `by ${theme.vendor} · ` : ""}
                {theme.free === true ? "Free" : theme.free === false ? "Paid" : "Unknown theme"}
                {theme.themeStoreId === null && theme.schemaName ? " · uploaded copy" : ""}
              </div>
              {theme.schemaName && theme.name !== theme.schemaName ? <div className="text-xs text-muted-foreground">Named “{theme.name}” in their store</div> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Couldn't read the theme.</p>
          )}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-2 flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" />Ad pixels</h4>
          {r.pixels.length ? (
            <ul className="text-sm space-y-0.5">{r.pixels.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : (
            <p className="text-sm text-muted-foreground">None found</p>
          )}
        </section>
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5"><Puzzle className="w-3.5 h-3.5" />Apps ({r.apps.length})</h4>
          {r.apps.length ? (
            <ul className="grid sm:grid-cols-2 gap-2">
              {r.apps.map((a) => (
                <li key={a.key} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-sm font-medium flex items-center gap-1">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-center gap-1">
                        {a.name} <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </a>
                    ) : (
                      a.name
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.category}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No apps found on the pages we read.</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Read from the store's home page and one product page. Apps that only run in the checkout or the admin don't show here.
          </p>
        </section>
      </div>
      <StoreAnalysisCard key={shown.id} inspectionId={shown.id} host={host} initial={analysis} />
      {r.teardown ? (
        <StoreTeardown teardown={r.teardown} host={host} />
      ) : r.teardown === undefined ? (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">Inspect the store again to see a teardown of its main product page.</p>
      ) : (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">We couldn't find a product page to tear down. Paste a product link to inspect one.</p>
      )}
    </div>
  );
}

// The host of a pasted link, for the "Ready to inspect" line.
function hostOf(link: string): string {
  try {
    return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

export default function StoreInspector() {
  const inspect = useAction(api.storeInspector.inspect);
  const recent = useQuery(api.storeInspector.recent, {});
  const { plan, isLoading: planLoading } = useUserPlan();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // Only the inspection the user ran or opened is expanded; past ones stay as chips.
  const [shown, setShown] = useState<Shown | null>(null);
  const tracked = !!recent?.find((x) => x.host === shown?.host)?.tracked;

  // Offer Search's "Teardown" links here with ?inspect=<store link>: fill it in and wait for the user to press Inspect.
  const [params, setParams] = useSearchParams();
  const linked = params.get("inspect");
  const filled = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || filled.current === linked) return;
    filled.current = linked;
    setUrl(linked);
  }, [linked]);
  const clearLinked = () =>
    setParams(
      (p) => {
        p.delete("inspect");
        p.set("tab", "inspect");
        return p;
      },
      { replace: true },
    );

  const run = async (link: string) => {
    if (!link.trim()) return;
    if (linked) clearLinked();
    setBusy(true);
    try {
      const r = await inspect({ url: link.trim() });
      setShown(r);
      setUrl("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't inspect the store"));
    } finally {
      setBusy(false);
    }
  };

  // Every inspection counts against a daily limit (5 free, more on Pro; convex/storeInspector.ts).
  const quotaHint = planLoading ? null : plan === "none" ? "Uses 1 of your 5 free inspections today" : "Uses 1 of today's inspections";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Radar className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Store Inspector</h2>
        <span className="text-xs text-muted-foreground">See which theme, apps and ad pixels any Shopify store runs, and how its product page sells</span>
      </div>
      {linked && !busy ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-sm flex-1 min-w-0">
            Ready to inspect <span className="font-medium break-all">{hostOf(linked)}</span>: reads its theme, apps and main product page.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => void run(linked)}>
              <Radar className="w-4 h-4 mr-2" />
              Inspect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setUrl(""); clearLinked(); }} aria-label="Dismiss">
              <X className="w-4 h-4" />
            </Button>
          </div>
          {quotaHint ? <p className="basis-full text-[11px] text-muted-foreground">{quotaHint}</p> : null}
        </div>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(url);
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a store link, like https://needyknee.se" disabled={busy} />
        <Button type="submit" disabled={busy || !url.trim()} className="shrink-0">
          {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Radar className="w-4 h-4 mr-2" />}
          {busy ? "Inspecting…" : "Inspect"}
        </Button>
      </form>
      {!linked && quotaHint ? <p className="text-[11px] text-muted-foreground -mt-1">{quotaHint}</p> : null}
      {recent && recent.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-0.5">Recent:</span>
          {recent.map((x) => {
            const open = shown?.host === x.host;
            return (
              <button
                key={x._id}
                type="button"
                aria-pressed={open}
                onClick={() => setShown(open ? null : { id: x._id, host: x.host, result: x.result })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition cursor-pointer",
                  open ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {x.host}
              </button>
            );
          })}
        </div>
      ) : null}
      {shown ? (
        <Result
          shown={shown}
          tracked={tracked}
          analysis={recent?.find((x) => x._id === shown.id)?.analysis ?? null}
          onClose={() => setShown(null)}
        />
      ) : null}
    </div>
  );
}
