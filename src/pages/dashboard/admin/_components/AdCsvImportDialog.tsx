import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { FileUp, Download } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  AD_PLATFORMS, AD_TEMPLATE_CSV, IMPORT_NICHES, autoMapAds, buildAdRows, decodeCsvBytes, parseCsv,
  type AdColumnMap, type AdField,
} from "@/lib/adCsv.ts";

const BATCH = 100; // importAds accepts at most 100 per call
const FIELD_LABELS: Record<AdField, string> = {
  advertiserName: "Advertiser",
  headline: "Headline",
  bodyText: "Ad text",
  creativeUrl: "Image / thumbnail",
  videoUrl: "Video URL",
  landingPageUrl: "Landing page",
  platform: "Platform",
  country: "Country",
  niche: "Niche",
  spend: "Spend",
  likes: "Likes",
  views: "Views / impressions",
  comments: "Comments",
  shares: "Shares",
  daysRunning: "Days running",
  firstSeen: "First seen / start date",
  lastSeen: "Last seen",
  ctaText: "Call to action",
  adLibraryUrl: "Ad link (library/post)",
  adId: "Ad ID",
};

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function AdCsvImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const importAds = useMutation(api.admin.externalImport.importAds);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<AdColumnMap>({});
  const [niche, setNiche] = useState<string>("auto");
  const [platform, setPlatform] = useState<string>("Facebook");
  const [country, setCountry] = useState("US");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);

  const built = useMemo(
    () => (table ? buildAdRows(table, map, { niche, platform, country: country.toUpperCase() || "US" }) : null),
    [table, map, niche, platform, country],
  );
  const header = table?.[0] ?? [];
  const hasMedia = map.creativeUrl !== undefined || map.videoUrl !== undefined;
  const hasText = map.headline !== undefined || map.bodyText !== undefined || map.advertiserName !== undefined;

  const reset = () => {
    setFileName(null);
    setTable(null);
    setMap({});
    setProgress(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function onFile(file: File) {
    reset();
    try {
      const text = decodeCsvBytes(await file.arrayBuffer());
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("The file has no data rows.");
      setTable(rows);
      setMap(autoMapAds(rows[0]));
      setFileName(file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read this file");
    }
  }

  async function runImport() {
    if (!built) return;
    const rows = built.rows;
    const totals = { created: 0, updated: 0 };
    setProgress(0);
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await importAds({ ads: rows.slice(i, i + BATCH) });
        totals.created += r.created;
        totals.updated += r.updated;
        setProgress(Math.round(((i + BATCH) / rows.length) * 100));
      }
      setResult(totals);
      toast.success(`Imported: ${totals.created} new, ${totals.updated} updated ads`);
    } catch (e) {
      setResult(totals);
      toast.error(e instanceof Error ? e.message : "Import stopped");
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import ads from CSV</DialogTitle>
          <DialogDescription>
            Works with Minea, PiPiAds, WinningHunter and Ad Library exports, or your own sheet. Needs an image or video URL and a headline, ad text or advertiser column. Re-importing the same file updates ads instead of duplicating them.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />

        {!table ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
            <FileUp className="w-8 h-8 text-muted-foreground" />
            <Button onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([AD_TEMPLATE_CSV], { type: "text/csv" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "adspy-ads-template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-3 h-3" /> Download a template
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium truncate">{fileName}</span>
              <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>Choose another file</Button>
            </div>

            {built && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ["Rows", built.total],
                  ["Ready to import", built.rows.length],
                  ["Duplicates removed", built.duplicates],
                  ["Missing media/text", built.invalid],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border border-border p-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold">{(value as number).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="text-xs font-medium mb-1.5">Column matching</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(FIELD_LABELS) as AdField[]).map((f) => (
                  <label key={f} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{FIELD_LABELS[f]}</span>
                    <select
                      className={selectCls + " max-w-[60%]"}
                      value={map[f] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })
                      }
                    >
                      <option value="">— not in file —</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {(!hasMedia || !hasText) && (
                <p className="text-xs text-destructive mt-2">
                  Pick a column for {!hasMedia ? "Image / thumbnail or Video URL" : ""}
                  {!hasMedia && !hasText ? ", and " : ""}
                  {!hasText ? "Headline, Ad text or Advertiser" : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                Niche
                <select className={selectCls} value={niche} disabled={busy} onChange={(e) => setNiche(e.target.value)}>
                  <option value="auto">Auto-detect from ad</option>
                  {IMPORT_NICHES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                Default platform
                <select className={selectCls} value={platform} disabled={busy} onChange={(e) => setPlatform(e.target.value)}>
                  {AD_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                Default country
                <input
                  className={selectCls + " w-16 uppercase"}
                  value={country}
                  maxLength={2}
                  disabled={busy}
                  onChange={(e) => setCountry(e.target.value.replace(/[^a-z]/gi, "").slice(0, 2))}
                />
              </label>
            </div>

            {built && built.rows.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="text-xs font-medium px-3 py-2 border-b border-border">Preview (first 5)</div>
                {built.rows.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0">
                    {r.creativeUrl ? (
                      <img src={r.creativeUrl} alt="" className="w-10 h-10 rounded object-cover bg-muted shrink-0" loading="lazy" />
                    ) : (
                      <video src={r.videoUrl} muted preload="metadata" className="w-10 h-10 rounded object-cover bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{r.headline}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.advertiserName} · {r.platform} · {r.country} · {r.niche}
                        {r.likes ? ` · ${r.likes.toLocaleString()} likes` : ""}
                        {r.daysRunning ? ` · ${r.daysRunning}d running` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {progress !== null && <Progress value={Math.min(progress, 100)} />}
            {result && (
              <p className="text-xs">
                Done: <strong>{result.created}</strong> new, <strong>{result.updated}</strong> updated.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => { onOpenChange(false); reset(); }} disabled={busy}>
            {result ? "Close" : "Cancel"}
          </Button>
          {table && !result && (
            <Button onClick={runImport} disabled={busy || !hasMedia || !hasText || !built?.rows.length}>
              {busy ? `Importing… ${progress}%` : `Import ${built?.rows.length.toLocaleString() ?? 0} ads`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
