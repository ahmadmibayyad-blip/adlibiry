import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, Image as ImageIcon, MonitorPlay, Type, Video } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { adRun, type GoogleAdPlatform } from "@/convex/lib/googleAds.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Store Inspector → Google & YouTube ads (convex/googleAds.ts): the store's ads in Google's Ads Transparency
// Center, on request (each lookup counts toward the day; the same store is kept 24 hours for everyone).

const PLATFORMS: { id: GoogleAdPlatform; label: string }[] = [
  { id: "all", label: "All" },
  { id: "youtube", label: "YouTube" },
  { id: "google_search", label: "Search" },
  { id: "google_shopping", label: "Shopping" },
];
const FORMAT = { video: { icon: Video, label: "Video" }, image: { icon: ImageIcon, label: "Image" }, text: { icon: Type, label: "Text" }, other: { icon: Type, label: "Ad" } };
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "?");

type Result = FunctionReturnType<typeof api.googleAds.forStore>;

export default function GoogleAdsSection({ host }: { host: string }) {
  const forStore = useAction(api.googleAds.forStore);
  const [platform, setPlatform] = useState<GoogleAdPlatform>("all");
  const [results, setResults] = useState<Partial<Record<GoogleAdPlatform, Result>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: GoogleAdPlatform) => {
    setPlatform(p);
    if (results[p]) return;
    setBusy(true);
    setError(null);
    try {
      const r = await forStore({ host, platform: p });
      setResults((old) => ({ ...old, [p]: r }));
    } catch (e) {
      setError(errorMessage(e, "Couldn't load their Google ads"));
    } finally {
      setBusy(false);
    }
  };

  const shown = results[platform];
  const active = shown ? shown.ads.filter((a) => adRun(a).active).length : 0;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <MonitorPlay className="w-3.5 h-3.5" />Google &amp; YouTube ads
        </h4>
        {Object.keys(results).length ? (
          <div className="flex gap-1">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void load(p.id)}
                disabled={busy}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs transition", platform === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!Object.keys(results).length && !busy ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load("all")}>
            <MonitorPlay className="w-4 h-4 mr-1.5" /> Show their Google &amp; YouTube ads
          </Button>
          <span className="text-xs text-muted-foreground">From Google's Ads Transparency Center: Search, YouTube, Shopping and more.</span>
        </div>
      ) : null}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="w-4 h-4" /> Reading Google's ad library…</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {shown && !busy ? (
        shown.ads.length ? (
          <>
            <p className="text-sm">
              {shown.estimate ? `About ${shown.estimate.toLocaleString("en-US")} ads` : `${shown.ads.length} ads`}
              {active ? ` · ${active} running now` : ""}
              <span className="text-muted-foreground"> (newest {shown.ads.length} below)</span>
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shown.ads.map((a) => {
                const f = FORMAT[a.format];
                const run = adRun(a);
                return (
                  <li key={a.creativeId} className="rounded-lg border border-border p-2 flex gap-2">
                    <div className="w-16 h-16 rounded-md bg-muted grid place-items-center overflow-hidden shrink-0">
                      {a.imageUrl ? <img src={a.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <f.icon className="w-5 h-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 text-xs space-y-0.5">
                      <div className="font-medium flex items-center gap-1">
                        {f.label}
                        {run.active ? <span className="rounded bg-good/15 text-good px-1">Running</span> : null}
                      </div>
                      <div className="text-muted-foreground">{day(a.firstShown)} – {day(a.lastShown)}{run.days ? ` · ${run.days} days` : ""}</div>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                        See the ad <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No {platform === "all" ? "Google" : PLATFORMS.find((p) => p.id === platform)?.label} ads found for {host}.</p>
        )
      ) : null}
    </section>
  );
}
