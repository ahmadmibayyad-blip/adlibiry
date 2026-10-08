import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction } from "convex/react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, Eye, RefreshCw, XCircle } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { StoreCheckItem } from "@/convex/lib/storeCheck.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// "Ready to sell?" (convex/storeCheck.ts): a checklist of what stands between
// the connected Shopify store and its first real order, each with a link to
// where it's fixed.

const ICON = {
  fix: <XCircle className="w-4 h-4 text-bad shrink-0 mt-0.5" />,
  reconnect: <RefreshCw className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />,
  check: <Eye className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
  ok: <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />,
} as const;

function Item({ item }: { item: StoreCheckItem }) {
  return (
    <li className="flex gap-2.5 py-2.5">
      {ICON[item.status]}
      <div className="min-w-0 flex-1 text-sm">
        <div className={cn("font-medium", item.status === "ok" && "font-normal")}>{item.title}</div>
        {item.detail && item.status !== "ok" ? <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p> : null}
        {item.status === "reconnect" ? (
          <Link to="/dashboard/settings" className="text-xs text-primary hover:underline">Settings → Shopify</Link>
        ) : item.fixUrl && item.status !== "ok" ? (
          <a href={item.fixUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5">
            {item.status === "fix" ? "Fix in Shopify" : "Open in Shopify"} <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

export default function StoreCheck({ variant = "outline", label = "Ready to sell?" }: { variant?: "outline" | "default"; label?: string }) {
  const run = useAction(api.storeCheck.run);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ shopDomain: string; items: StoreCheckItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await run({}));
    } catch (err) {
      setError(errorMessage(err, "Couldn't check your store"));
    } finally {
      setBusy(false);
    }
  };

  const fixes = result?.items.filter((i) => i.status === "fix").length ?? 0;
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        onClick={() => {
          setOpen(true);
          if (!busy) check();
        }}
      >
        <ClipboardCheck className="w-4 h-4 mr-1.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ready to sell?</DialogTitle>
            <DialogDescription>What your Shopify store still needs before you run ads to it.</DialogDescription>
          </DialogHeader>
          {busy && !result ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner className="w-4 h-4" /> Checking your store…</div>
          ) : error ? (
            <p className="text-sm text-bad">{error}</p>
          ) : result ? (
            <>
              <div className={cn("flex items-start gap-2 rounded-lg p-3 text-sm", fixes ? "bg-bad/10" : "bg-primary/10")}>
                {fixes ? <AlertTriangle className="w-4 h-4 text-bad shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />}
                <span>
                  {fixes
                    ? `${fixes} thing${fixes === 1 ? "" : "s"} to fix in ${result.shopDomain} before you run ads.`
                    : "Nothing to fix. Check the items below, place a test order, and you're ready for ads."}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {result.items.map((i) => <Item key={i.id} item={i} />)}
              </ul>
              <Button variant="outline" size="sm" onClick={check} disabled={busy}>
                {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                Check again
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
