import { useState } from "react";
import { Authenticated, useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Launch (convex/launch.ts): the product becomes a written, priced product
// page in the user's Shopify store, plus an ad kit from its winning ads.

const LANGUAGES: Record<string, string> = {
  en: "English", da: "Danish", de: "German", sv: "Swedish", nb: "Norwegian", no: "Norwegian", fr: "French", es: "Spanish",
  nl: "Dutch", it: "Italian", pl: "Polish", fi: "Finnish", pt: "Portuguese",
};
const TONES = [
  ["friendly", "Friendly"],
  ["premium", "Premium"],
  ["bold", "Bold"],
] as const;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground shrink-0"
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function Progress({ launchId, onAgain }: { launchId: Id<"launches">; onAgain: () => void }) {
  const l = useQuery(api.launch.get, { launchId });
  if (!l) return <Spinner />;
  if (l.status === "generating" || l.status === "publishing") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-sm">
        <Spinner className="w-6 h-6" />
        {l.status === "generating" ? "Writing your page from the ads that are winning…" : "Creating it in your Shopify store…"}
      </div>
    );
  }
  if (l.status === "failed") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-bad">{l.error ?? "Launch failed."}</p>
        <Button variant="outline" onClick={onAgain}>Try again</Button>
      </div>
    );
  }
  const copy = l.copy as { title: string; adKit: { angle: string; hook: string; primaryText: string; headline: string }[] } | undefined;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <strong>“{copy?.title}”</strong> is in your store{l.publish === "DRAFT" ? " as a draft. Check it, then set it to Active in Shopify." : " and live."}
      </p>
      <div className="flex flex-wrap gap-2">
        {l.adminUrl && (
          <Button asChild>
            <a href={l.adminUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" />Open in Shopify</a>
          </Button>
        )}
        {l.storeUrl && (
          <Button asChild variant="outline">
            <a href={l.storeUrl} target="_blank" rel="noopener noreferrer">View the page</a>
          </Button>
        )}
      </div>
      {copy?.adKit?.length ? (
        <div>
          <h4 className="text-sm font-semibold mb-2">Your ad kit</h4>
          <ul className="space-y-2">
            {copy.adKit.map((a, i) => (
              <li key={i} className="rounded-lg border border-border p-2.5 text-xs space-y-1">
                <div className="font-medium">{a.angle}</div>
                {[["Hook", a.hook], ["Primary text", a.primaryText], ["Headline", a.headline]].map(([label, text]) => (
                  <div key={label} className="flex gap-2 items-start">
                    <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                    <span className="flex-1">{text}</span>
                    <CopyButton text={text} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link to="/dashboard/launch" className="text-xs text-primary hover:underline">All your launches →</Link>
    </div>
  );
}

function LaunchButton({ product }: { product: Doc<"products"> }) {
  const [open, setOpen] = useState(false);
  const prep = useQuery(api.launch.prepare, open ? { productId: product._id } : "skip");
  const status = useQuery(api.shopifyApp.status, open ? {} : "skip");
  const start = useMutation(api.launch.start);
  // null: not touched yet, so the suggested price and the store's language apply.
  const [priceInput, setPrice] = useState<string | null>(null);
  const [languageInput, setLanguage] = useState<string | null>(null);
  const [tone, setTone] = useState<(typeof TONES)[number][0]>("friendly");
  const [publish, setPublish] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [launchId, setLaunchId] = useState<Id<"launches"> | null>(null);
  const [busy, setBusy] = useState(false);

  const price = priceInput ?? (prep?.suggested.price ? String(prep.suggested.price) : "");
  const language = languageInput ?? (prep?.store?.locale ? (LANGUAGES[prep.store.locale.slice(0, 2)] ?? "English") : "English");
  // A launch of this product still running from before shows its progress.
  const stillRunning = prep?.last && (prep.last.status === "generating" || prep.last.status === "publishing") ? prep.last._id : null;
  const shownLaunch = launchId ?? stillRunning;

  const cost = prep?.suggested.cost;
  const priceNum = Number(price);
  const margin = cost && priceNum > 0 ? Math.round(((priceNum - cost) / priceNum) * 100) : undefined;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Rocket className="w-4 h-4 mr-2" />
        Launch
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setLaunchId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Launch to Shopify</DialogTitle>
            <DialogDescription>A product page written from the ads already selling it, priced from the real supplier cost.</DialogDescription>
          </DialogHeader>
          {!prep || !status ? (
            <Spinner />
          ) : shownLaunch ? (
            <Progress launchId={shownLaunch} onAgain={() => setLaunchId(null)} />
          ) : prep.blocked ? (
            <p className="text-sm text-bad">{prep.blocked}</p>
          ) : !prep.allowed ? (
            <div className="space-y-2 text-sm">
              <p>Launch is part of Pro. Start the free 7-day trial to launch 2 products.</p>
              <Button asChild><Link to="/#pricing">See plans</Link></Button>
            </div>
          ) : !prep.store ? (
            status.appReady ? (
              <div className="space-y-2">
                <p className="text-sm">Connect your Shopify store once. Products arrive as drafts until you publish them.</p>
                <ConnectShopify />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Connect your store with “Add to Shopify” first (the AdSpy Pro Shopify app is being set up).</p>
            )
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await start({ productId: product._id, language, tone, publish, ...(priceNum > 0 ? { price: priceNum } : {}) });
                  setLaunchId(r.launchId);
                } catch (err) {
                  toast.error(errorMessage(err, "Couldn't start the launch"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-xs text-muted-foreground">
                Store: <strong className="text-foreground">{prep.store.shopName}</strong> ·{" "}
                {prep.allowed.left === null ? "unlimited launches" : `${prep.allowed.left} of ${prep.allowed.limit} launches left`}
              </p>
              <label className="block text-sm">
                <span className="font-medium">Price ({prep.store.currency})</span>
                <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
                <span className="text-xs text-muted-foreground">
                  {cost ? `Supplier cost ${cost.toFixed(2)} incl. shipping · margin ${margin ?? "–"}%` : "No supplier cost known: check your margin."}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="font-medium">Language</span>
                  <select className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {[...new Set(Object.values(LANGUAGES))].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Tone</span>
                  <select className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
                    {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={publish === "ACTIVE"} onChange={(e) => setPublish(e.target.checked ? "ACTIVE" : "DRAFT")} />
                Publish it live now (otherwise it's saved as a draft for you to check)
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Spinner /> : <Rocket className="w-4 h-4 mr-2" />}
                Write and launch
              </Button>
              <p className="text-[11px] text-muted-foreground">
                The AI only uses real facts: no invented reviews, sales numbers or health claims. Check the page before you run ads.
              </p>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function LaunchDialog({ product }: { product: Doc<"products"> }) {
  return (
    <Authenticated>
      <LaunchButton product={product} />
    </Authenticated>
  );
}
