import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { OFFER_COUNTRIES } from "@/convex/lib/offerSearch.ts";
import FilterSelect from "@/components/FilterSelect.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { StoreResults } from "@/pages/dashboard/offer-search/_components/StoreResults.tsx";

// Admin → Offer research: the daily run of every offer in every Offer Search country
// (convex/offerSearch.ts dailyResearch, ~1,000 ads a day), with the same store cards and filters as Offer Search.

export default function OfferResearchTab() {
  const [day, setDay] = useState<string | undefined>(undefined);
  const data = useQuery(api.offerSearch.research, day ? { day } : {});
  const runNow = useMutation(api.importRuns.runNow);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  const stores = useMemo(() => (data?.countries ?? []).flatMap((c) => c.stores), [data]);
  if (data === undefined) return <Skeleton className="h-64 w-full rounded-xl" />;

  const done = data.countries.filter((c) => c.status === "done");
  const running = data.countries.filter((c) => c.status === "running");
  const failed = data.countries.filter((c) => c.status === "failed");
  const ads = done.reduce((n, c) => n + c.adsFound, 0);

  const start = async () => {
    if (busy || started) return;
    setBusy(true);
    try {
      await runNow({ job: "offerResearch" });
      setStarted(true);
      toast.success("Offer research started. Each country's results arrive here in 1–5 minutes.");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't start the research"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Offer research</h2>
            <p className="text-sm text-muted-foreground">
              Every day at 09:50 UTC: every offer (Buy 2 get 1, % off, free shipping, free gift, buy more save more) in all {Object.keys(OFFER_COUNTRIES).length} Offer Search countries, about
              1,000 active ads in all through Apify (~$0.75). The ads also go into Ad Spy. Change the total with OFFER_RESEARCH_ADS in Convex (off stops it).
            </p>
          </div>
          <Button size="sm" className="h-10 sm:h-8" onClick={() => void start()} disabled={busy || started}>
            {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <Play className="w-4 h-4 mr-1.5" />} {started ? "Started" : "Run now"}
          </Button>
        </div>
        {data.day ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FilterSelect label="Day" value={data.day} onChange={setDay} options={data.days.map((d) => ({ value: d, label: d }))} />
            <span className="text-muted-foreground">
              {done.length} of {data.countries.length} countries done · {ads.toLocaleString()} ads · {stores.length} stores
              {running.length ? ` · still running: ${running.map((c) => c.country).join(", ")}` : ""}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No research yet. It runs every morning, or press Run now.</p>
        )}
        {failed.length ? (
          <ul className="text-xs text-bad space-y-0.5">
            {failed.map((c) => (
              <li key={c.country}>
                {c.country}: {c.error ?? "failed"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {stores.length ? <StoreResults stores={stores} showCountry /> : null}
    </div>
  );
}
