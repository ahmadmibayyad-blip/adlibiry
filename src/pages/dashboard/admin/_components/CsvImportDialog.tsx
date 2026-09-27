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
  IMPORT_CATEGORIES, TEMPLATE_CSV, autoMap, buildRows, decodeCsvBytes, parseCsv, type ColumnMap,
} from "@/lib/productCsv.ts";

const BATCH = 150;
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  imageUrl: "Image",
  productUrl: "Product link",
  priceUsd: "Price (USD)",
  originalPrice: "Original price",
  cost: "Cost",
  category: "Category",
  ads: "Ads",
  likes: "Likes",
  growthPercent: "Growth",
  researchUrl: "Research link",
  description: "Description",
};

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function CsvImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const importProducts = useMutation(api.admin.productImport.importProducts);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [category, setCategory] = useState<string>("auto");
  const [markWinners, setMarkWinners] = useState(false);
  const [sourceName, setSourceName] = useState("CSV");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  const built = useMemo(() => (table ? buildRows(table, map, { category }) : null), [table, map, category]);
  const header = table?.[0] ?? [];
  const missing = ["title", "imageUrl"].filter((f) => map[f as keyof ColumnMap] === undefined);

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
      setMap(autoMap(rows[0]));
      setFileName(file.name);
      const h = rows[0].join(" ").toLowerCase();
      setSourceName(h.includes("usd price") && h.includes("growth rate") ? "PiPiAds" : "CSV");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read this file");
    }
  }

  async function runImport() {
    if (!built) return;
    const rows = built.rows;
    const totals = { created: 0, updated: 0, skipped: 0 };
    setProgress(0);
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await importProducts({ rows: rows.slice(i, i + BATCH), source: sourceName, markWinners });
        totals.created += r.created;
        totals.updated += r.updated;
        totals.skipped += r.skipped;
        setProgress(Math.round(((i + BATCH) / rows.length) * 100));
      }
      setResult(totals);
      toast.success(`Imported: ${totals.created} new, ${totals.updated} updated`);
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
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            Works with PiPiAds, Minea, Kalodata and Shopify exports, or your own sheet. Needs at least a title and an image URL column. Re-importing updates existing products instead of duplicating them.
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
                const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "adspy-products-template.csv";
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
                  ["Missing title/image", built.invalid],
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
                {Object.keys(FIELD_LABELS).map((f) => (
                  <label key={f} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{FIELD_LABELS[f]}</span>
                    <select
                      className={selectCls + " max-w-[60%]"}
                      value={map[f as keyof ColumnMap] ?? ""}
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
              {missing.length > 0 && (
                <p className="text-xs text-destructive mt-2">Pick a column for: {missing.map((m) => FIELD_LABELS[m]).join(", ")}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                Category
                <select className={selectCls} value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>
                  <option value="auto">Auto-detect from title</option>
                  {IMPORT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                Source name
                <input
                  className={selectCls + " w-28"}
                  value={sourceName}
                  disabled={busy}
                  onChange={(e) => setSourceName(e.target.value.slice(0, 40))}
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={markWinners} disabled={busy} onChange={(e) => setMarkWinners(e.target.checked)} />
                Also show on the Dashboard as "Today's winners"
              </label>
            </div>

            {built && built.rows.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="text-xs font-medium px-3 py-2 border-b border-border">Preview (first 5)</div>
                {built.rows.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0">
                    <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover bg-muted shrink-0" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{r.title}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.category}
                        {r.priceUsd !== undefined ? ` · $${r.priceUsd.toFixed(2)}` : ""}
                        {r.ads !== undefined ? ` · ${r.ads} ads` : ""}
                        {r.likes !== undefined ? ` · ${Math.round(r.likes).toLocaleString()} likes` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {progress !== null && <Progress value={Math.min(progress, 100)} />}
            {result && (
              <p className="text-xs">
                Done: <strong>{result.created}</strong> new, <strong>{result.updated}</strong> updated, {result.skipped} skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => { onOpenChange(false); reset(); }} disabled={busy}>
            {result ? "Close" : "Cancel"}
          </Button>
          {table && !result && (
            <Button onClick={runImport} disabled={busy || missing.length > 0 || !built?.rows.length}>
              {busy ? `Importing… ${progress}%` : `Import ${built?.rows.length.toLocaleString() ?? 0} products`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
