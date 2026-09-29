import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Download, Store, Clapperboard, Trophy, Tags, Coins } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { NICHES as ALL_NICHES } from "@/convex/lib/category.ts";

// Fallback niche for imports: used only when the ad itself doesn't make its
// niche clear (each ad is classified from its own text and link).
const NICHES: string[] = ALL_NICHES.filter((n) => n !== "Other");
const TIKTOK_COUNTRIES = ["gb", "de", "fr", "es", "it", "us"];
const META_COUNTRIES = ["DK", "SE", "NO", "DE", "GB", "NL", "FR", "US"];

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Result({ lines, errors }: { lines: [string, number | string][]; errors: string[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap text-xs">
      {lines.map(([label, value]) => (
        <span key={label} className="text-muted-foreground">
          {label} <strong className="text-foreground">{value}</strong>
        </span>
      ))}
      {errors.length > 0 && (
        <div className="w-full text-destructive">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ icon: Icon, title, text, children }: { icon: typeof Store; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{text}</p>
      {children}
    </div>
  );
}

export default function DataSourcesPanel() {
  // Nexscope TikTok ads
  const importTikTok = useAction(api.nexscope.tiktokAds.importTikTokAdsNow);
  const [tt, setTt] = useState({ country: "gb", keyword: "", niche: NICHES[0], pages: 2 });
  const [ttBusy, setTtBusy] = useState(false);
  const [ttRes, setTtRes] = useState<{ fetched: number; created: number; updated: number; totalAvailable: number; errors: string[] } | null>(null);

  // Nexscope Shopify stores
  const importStores = useAction(api.nexscope.tiktokAds.importShopifyStoresNow);
  const [st, setSt] = useState({ country: "DK", niche: NICHES[0], searchKey: "", minAds: 3 });
  const [stBusy, setStBusy] = useState(false);
  const [stRes, setStRes] = useState<{ fetched: number; created: number; updated: number; errors: string[] } | null>(null);

  // Apify Meta Ad Library
  const startApify = useAction(api.apify.startImportNow);
  const importDataset = useAction(api.apify.importDatasetNow);
  const [ap, setAp] = useState({ country: "DK", keyword: "", niche: NICHES[0], maxAds: 100, datasetId: "" });
  const [apBusy, setApBusy] = useState(false);
  const [apMsg, setApMsg] = useState<string | null>(null);
  const [apRes, setApRes] = useState<{ fetched: number; created: number; updated: number; skipped: number; errors: string[] } | null>(null);

  // WinningHunter REST
  const whImport = useAction(api.winninghunter.importNow);
  const whCredits = useAction(api.winninghunter.creditsNow);
  const [wh, setWh] = useState({ country: "DK", keyword: "", media: "", score: "winning", pages: 2 });
  const [whBusy, setWhBusy] = useState(false);
  const [whInfo, setWhInfo] = useState<string | null>(null);
  const [whRes, setWhRes] = useState<{ calls: number; fetched: number; adsCreated: number; adsUpdated: number; productsCreated: number; productsUpdated: number; errors: string[] } | null>(null);

  // PiPiSpy
  const pipiImport = useAction(api.pipispy.importNow);
  const pipiCheck = useAction(api.pipispy.checkKeyNow);
  const pipiCredits = useQuery(api.pipispy.creditsStatus, {});
  const [pp, setPp] = useState({ country: "DK", platform: "", keyword: "", max: 50, activeOnly: true });
  const [ppBusy, setPpBusy] = useState(false);
  const [ppInfo, setPpInfo] = useState<string | null>(null);
  const [ppRes, setPpRes] = useState<{ fetched: number; created: number; updated: number; skipped: number; creditsUsed: number; creditsRemaining?: number; errors: string[] } | null>(null);

  // Re-check niches of already-imported ads/products
  const startReclassify = useMutation(api.admin.reclassify.start);
  const reclassify = useQuery(api.admin.reclassify.status, {});

  const fail = (e: unknown, fallback: string) => toast.error(e instanceof Error ? e.message : fallback);

  return (
    <div className="grid gap-4 mb-5 lg:grid-cols-2 xl:grid-cols-4">
      <Card
        icon={Tags}
        title="Fix niches"
        text="Re-checks the niche of every auto-imported ad and product from its own text and product link (they used to get the niche that was searched for). Niches you set by hand are kept."
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            disabled={reclassify?.running}
            onClick={async () => {
              try {
                const r = await startReclassify({});
                toast[r.alreadyRunning ? "info" : "success"](r.alreadyRunning ? "Already running" : "Re-checking niches…");
              } catch (e) {
                fail(e, "Could not start");
              }
            }}
          >
            {reclassify?.running ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <Tags className="w-3.5 h-3.5 mr-1.5" />}
            {reclassify?.running ? "Running…" : "Re-check niches"}
          </Button>
        </div>
        {reclassify && (
          <Result
            lines={[
              ["Ads changed", reclassify.adsChanged],
              ["Products changed", reclassify.productsChanged],
              ["Status", reclassify.running ? "running" : `done ${new Date(reclassify.finishedAt ?? reclassify.startedAt).toLocaleString()}`],
            ]}
            errors={[]}
          />
        )}
      </Card>

      <Card icon={Trophy} title="WinningHunter (Meta ads + products)" text="Active winning Facebook/Instagram ads with video, EU reach, spend, countries and the Shopify product behind them. 1 credit per 50 ads. Runs daily by itself once the API key is set.">
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={wh.country} onChange={(e) => setWh({ ...wh, country: e.target.value })}>
            {META_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={selectCls} value={wh.score} onChange={(e) => setWh({ ...wh, score: e.target.value })}>
            <option value="winning">Winning</option>
            <option value="scaling">Scaling</option>
            <option value="">Any score</option>
          </select>
          <select className={selectCls} value={wh.media} onChange={(e) => setWh({ ...wh, media: e.target.value })}>
            <option value="">All media</option>
            <option value="videos">Videos</option>
            <option value="images">Images</option>
          </select>
          <Input className="h-9 w-36" placeholder="Keyword (optional)" value={wh.keyword} onChange={(e) => setWh({ ...wh, keyword: e.target.value })} />
          <select className={selectCls} value={wh.pages} onChange={(e) => setWh({ ...wh, pages: Number(e.target.value) })}>
            {[1, 2, 4, 6].map((n) => <option key={n} value={n}>{n * 50} ads</option>)}
          </select>
          <Button
            size="sm"
            disabled={whBusy}
            onClick={async () => {
              setWhBusy(true);
              setWhRes(null);
              try {
                setWhRes(await whImport({
                  countries: wh.country,
                  keyword: wh.keyword || undefined,
                  mediafilter: wh.media || undefined,
                  adscorefilter: wh.score || undefined,
                  pages: wh.pages,
                }));
              } catch (e) {
                fail(e, "Import failed");
              } finally {
                setWhBusy(false);
              }
            }}
          >
            {whBusy ? <Spinner className="w-4 h-4" /> : "Import now"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await whCredits({});
                setWhInfo(!r.configured ? "API key not set yet (Convex → Environment Variables → WINNINGHUNTER_API_KEY)" : r.error ? r.error : `Credits: ${JSON.stringify(r.credits)}`);
              } catch (e) {
                fail(e, "Check failed");
              }
            }}
          >
            Check key
          </Button>
        </div>
        {whInfo && <p className="mt-2 text-xs text-muted-foreground break-all">{whInfo}</p>}
        {whRes && (
          <Result
            lines={[["Calls", whRes.calls], ["Fetched", whRes.fetched], ["New ads", whRes.adsCreated], ["Updated ads", whRes.adsUpdated], ["New products", whRes.productsCreated]]}
            errors={whRes.errors}
          />
        )}
      </Card>

      <Card
        icon={Coins}
        title="PiPiSpy (TikTok + Facebook ads)"
        text="TikTok and Facebook ads for any country incl. DK/SE/NO, with video, plays, likes, comments, shares, CTA and PiPiSpy's spend estimate. Each ad costs 1 credit — imports are capped by PIPISPY_MAX_PER_RUN (default 100)."
      >
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={pp.country} onChange={(e) => setPp({ ...pp, country: e.target.value })}>
            {META_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={selectCls} value={pp.platform} onChange={(e) => setPp({ ...pp, platform: e.target.value })}>
            <option value="">TikTok + Facebook</option>
            <option value="tiktok">TikTok</option>
            <option value="facebook">Facebook</option>
          </select>
          <Input className="flex-1 min-w-[140px]" placeholder="Keyword (optional)" value={pp.keyword} onChange={(e) => setPp({ ...pp, keyword: e.target.value })} />
          <select className={selectCls} value={pp.max} onChange={(e) => setPp({ ...pp, max: Number(e.target.value) })}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} ads = {n} credits</option>)}
          </select>
          <Button
            size="sm"
            disabled={ppBusy}
            onClick={async () => {
              setPpBusy(true);
              setPpRes(null);
              try {
                const r = await pipiImport({
                  country: pp.country,
                  platform: pp.platform || undefined,
                  keyword: pp.keyword.trim() || undefined,
                  maxAds: pp.max,
                  activeOnly: pp.activeOnly,
                });
                setPpRes(r);
                if (r.errors.length) toast.error(`Imported with ${r.errors.length} message(s)`);
                else toast.success(`${r.created} new ads from PiPiSpy`);
              } catch (e) {
                fail(e, "PiPiSpy import failed");
              } finally {
                setPpBusy(false);
              }
            }}
          >
            {ppBusy ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            {ppBusy ? "Importing..." : "Import"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await pipiCheck({});
                setPpInfo(
                  !r.configured
                    ? "API key not set yet (Convex → Environment Variables → PIPISPY_API_KEY)"
                    : r.error ?? `Key works — ${r.remainingCredits?.toLocaleString() ?? "?"} credits left`,
                );
              } catch (e) {
                fail(e, "Check failed");
              }
            }}
            title="Uses 1 credit"
          >
            Check key
          </Button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={pp.activeOnly} onChange={(e) => setPp({ ...pp, activeOnly: e.target.checked })} />
          Only ads that are still running
        </label>
        {pipiCredits && (
          <p className="mt-2 text-xs text-muted-foreground">
            Credits left: <strong className="text-foreground">{pipiCredits.remainingCredits.toLocaleString()}</strong> (as of {new Date(pipiCredits.checkedAt).toLocaleString()})
          </p>
        )}
        {ppInfo && <p className="mt-1 text-xs text-muted-foreground break-all">{ppInfo}</p>}
        {ppRes && (
          <Result
            lines={[["Fetched", ppRes.fetched], ["New ads", ppRes.created], ["Updated", ppRes.updated], ["Credits used", ppRes.creditsUsed]]}
            errors={ppRes.errors}
          />
        )}
      </Card>

      <Card icon={Clapperboard} title="TikTok ads (Nexscope)" text="Real TikTok Shop ads with cover image, views, likes, days running and GMV. Leave the keyword empty to get the market's top ads by sales. Covers GB, DE, FR, ES, IT, US (not DK/SE/NO). 1 search call per 10 ads + 1 detail call per ad.">
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={tt.country} onChange={(e) => setTt({ ...tt, country: e.target.value })}>
            {TIKTOK_COUNTRIES.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <select className={selectCls} value={tt.niche} onChange={(e) => setTt({ ...tt, niche: e.target.value })}>
            {NICHES.map((n) => <option key={n}>{n}</option>)}
          </select>
          <Input className="flex-1 min-w-[140px]" placeholder="Keyword (optional), e.g. dog harness" value={tt.keyword} onChange={(e) => setTt({ ...tt, keyword: e.target.value })} />
          <select className={selectCls} value={tt.pages} onChange={(e) => setTt({ ...tt, pages: Number(e.target.value) })}>
            {[1, 2, 3, 5].map((p) => <option key={p} value={p}>{p * 10} ads</option>)}
          </select>
          <Button
            size="sm"
            disabled={ttBusy}
            onClick={async () => {
              setTtBusy(true);
              try {
                const r = await importTikTok({ country: tt.country, keyword: tt.keyword.trim(), niche: tt.niche, maxPages: tt.pages });
                setTtRes(r);
                r.errors.length ? toast.error(`Imported with ${r.errors.length} error(s)`) : toast.success(`${r.created} new TikTok ads`);
              } catch (e) {
                fail(e, "TikTok import failed");
              } finally {
                setTtBusy(false);
              }
            }}
          >
            {ttBusy ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            {ttBusy ? "Importing..." : "Import"}
          </Button>
        </div>
        {ttRes && <Result lines={[["Fetched", ttRes.fetched], ["Created", ttRes.created], ["Updated", ttRes.updated], ["Available", ttRes.totalAvailable]]} errors={ttRes.errors} />}
      </Card>

      <Card icon={Store} title="Shopify stores that advertise (Nexscope)" text="Shopify stores with active ads, traffic and order estimates. They appear in Store Tracker. The search box matches store names/domains, not products — leave it empty for the top advertisers.">
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={st.country} onChange={(e) => setSt({ ...st, country: e.target.value })}>
            {META_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={selectCls} value={st.niche} onChange={(e) => setSt({ ...st, niche: e.target.value })}>
            {NICHES.map((n) => <option key={n}>{n}</option>)}
          </select>
          <Input className="flex-1 min-w-[140px]" placeholder="Store name/domain (optional)" value={st.searchKey} onChange={(e) => setSt({ ...st, searchKey: e.target.value })} />
          <Input className="w-24" type="number" min={1} value={st.minAds} onChange={(e) => setSt({ ...st, minAds: Number(e.target.value) || 1 })} title="Minimum active ads" />
          <Button
            size="sm"
            disabled={stBusy}
            onClick={async () => {
              setStBusy(true);
              try {
                const r = await importStores({ country: st.country, niche: st.niche, searchKey: st.searchKey.trim() || undefined, minAds: st.minAds });
                setStRes(r);
                r.errors.length ? toast.error(`Imported with ${r.errors.length} error(s)`) : toast.success(`${r.created} new stores`);
              } catch (e) {
                fail(e, "Store import failed");
              } finally {
                setStBusy(false);
              }
            }}
          >
            {stBusy ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            {stBusy ? "Importing..." : "Import"}
          </Button>
        </div>
        {stRes && <Result lines={[["Fetched", stRes.fetched], ["Created", stRes.created], ["Updated", stRes.updated]]} errors={stRes.errors} />}
      </Card>

      <Card icon={Download} title="Meta Ad Library (Apify)" text="Facebook + Instagram ads for any country incl. DK/SE/NO. Runs on Apify; results arrive automatically in a few minutes.">
        <div className="flex flex-wrap gap-2">
          <select className={selectCls} value={ap.country} onChange={(e) => setAp({ ...ap, country: e.target.value })}>
            {META_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={selectCls} value={ap.niche} onChange={(e) => setAp({ ...ap, niche: e.target.value })}>
            {NICHES.map((n) => <option key={n}>{n}</option>)}
          </select>
          <Input className="flex-1 min-w-[140px]" placeholder="Keyword, e.g. hundeseng" value={ap.keyword} onChange={(e) => setAp({ ...ap, keyword: e.target.value })} />
          <select className={selectCls} value={ap.maxAds} onChange={(e) => setAp({ ...ap, maxAds: Number(e.target.value) })}>
            {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} ads</option>)}
          </select>
          <Button
            size="sm"
            disabled={apBusy || !ap.keyword.trim()}
            onClick={async () => {
              setApBusy(true);
              try {
                const r = await startApify({ country: ap.country, keyword: ap.keyword.trim(), niche: ap.niche, maxAds: ap.maxAds });
                setApMsg(
                  r.webhook
                    ? `Run ${r.runId} started — ads appear automatically when it finishes.`
                    : `Run ${r.runId} started. The webhook could not be registered, so import its dataset below when it finishes.`,
                );
                toast.success("Apify run started");
              } catch (e) {
                fail(e, "Could not start Apify run");
              } finally {
                setApBusy(false);
              }
            }}
          >
            {apBusy ? <Spinner className="w-3.5 h-3.5 mr-1.5" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
            Start run
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Input className="flex-1 min-w-[140px]" placeholder="Or import a finished dataset ID" value={ap.datasetId} onChange={(e) => setAp({ ...ap, datasetId: e.target.value })} />
          <Button
            size="sm"
            variant="secondary"
            disabled={apBusy || !ap.datasetId.trim()}
            onClick={async () => {
              setApBusy(true);
              try {
                const r = await importDataset({ datasetId: ap.datasetId.trim(), country: ap.country, niche: ap.niche });
                setApRes(r);
                r.errors.length ? toast.error(`Imported with ${r.errors.length} error(s)`) : toast.success(`${r.created} new Meta ads`);
              } catch (e) {
                fail(e, "Dataset import failed");
              } finally {
                setApBusy(false);
              }
            }}
          >
            Import dataset
          </Button>
        </div>
        {apMsg && <p className="text-xs text-muted-foreground mt-2">{apMsg}</p>}
        {apRes && <Result lines={[["Fetched", apRes.fetched], ["Created", apRes.created], ["Updated", apRes.updated], ["Skipped", apRes.skipped]]} errors={apRes.errors} />}
      </Card>
    </div>
  );
}
