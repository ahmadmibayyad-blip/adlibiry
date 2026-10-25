import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, ExternalLink, PackageCheck, RefreshCw, Store, Truck } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { OrderStatus, TrackedOrder } from "@/convex/lib/orderTracker.ts";
import { LATE_DAYS } from "@/convex/lib/orderTracker.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Orders (convex/orders.ts): the store's last 30 days of orders, whoever ships them. The owner fulfills with their own
// app (CJ, DSers, AutoDS, Zendrop...), an agent, or by hand; AdSpy reads status and tracking from Shopify and points out
// the orders that need a look. It places nothing.

type Loaded = FunctionReturnType<typeof api.orders.load>;

const STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  waiting: { label: "To ship", tone: "bg-muted text-foreground" },
  on_hold: { label: "On hold", tone: "bg-warn/15 text-warn" },
  partly: { label: "Partly shipped", tone: "bg-primary/10 text-primary" },
  shipped: { label: "On the way", tone: "bg-primary/10 text-primary" },
  delivered: { label: "Delivered", tone: "bg-good/15 text-good" },
  unpaid: { label: "Not paid", tone: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "look", label: "Needs a look" },
  { value: "ship", label: "To ship" },
  { value: "way", label: "On the way" },
  { value: "delivered", label: "Delivered" },
  { value: "other", label: "Not paid or cancelled" },
];
const matches = (o: TrackedOrder, f: string) =>
  f === "all" ||
  (f === "look" && !!o.warning) ||
  (f === "ship" && (o.status === "waiting" || o.status === "on_hold" || o.status === "partly")) ||
  (f === "way" && o.status === "shipped") ||
  (f === "delivered" && o.status === "delivered") ||
  (f === "other" && (o.status === "unpaid" || o.status === "cancelled"));

// Fulfillment apps on the Shopify App Store, for stores that ship nothing yet. Any other app or an agent works too.
const APPS = [
  { name: "CJ Dropshipping", url: "https://apps.shopify.com/search?q=cj%20dropshipping" },
  { name: "DSers", url: "https://apps.shopify.com/dsers" },
  { name: "AutoDS", url: "https://apps.shopify.com/autods" },
  { name: "Zendrop", url: "https://apps.shopify.com/zendrop" },
];

const money = (t: TrackedOrder["total"]) => {
  if (!t) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: t.currency }).format(t.amount);
  } catch {
    return `${t.amount} ${t.currency}`;
  }
};
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function OrdersPage() {
  const data = useQuery(api.orders.mine, {});
  const load = useAction(api.orders.load);
  const [result, setResult] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const canUse = !!data?.store?.canUse;

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await load({}));
    } catch (e) {
      setError(errorMessage(e, "Couldn't read your orders from Shopify"));
    } finally {
      setBusy(false);
    }
  }, [load]);

  // First load when the page opens; Refresh reloads.
  useEffect(() => {
    if (!canUse) return;
    let live = true;
    load({}).then(
      (r) => live && setResult(r),
      (e: unknown) => live && setError(errorMessage(e, "Couldn't read your orders from Shopify")),
    );
    return () => {
      live = false;
    };
  }, [canUse, load]);

  if (data === undefined) return <div className="p-6"><Spinner className="w-5 h-5" /></div>;
  if (!data) return null;

  const s = result?.summary;
  const list = result?.orders.filter((o) => matches(o, filter)) ?? [];
  const shipsNothing = !!s && s.onTheWay + s.delivered === 0 && !result?.orders.some((o) => o.status === "partly");

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PackageCheck className="w-6 h-6 text-primary" /> Orders</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Your Shopify orders from the last 30 days, whoever ships them: your fulfillment app (CJ, DSers, AutoDS, Zendrop…), your agent, or
            you. AdSpy reads the status and tracking from Shopify and shows which orders need a look.
          </p>
        </div>
        {canUse ? (
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />} Refresh
          </Button>
        ) : null}
      </div>

      {!data.store ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>Connect your Shopify store to see your orders here.</p>
          <ConnectShopify />
        </div>
      ) : !canUse ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>AdSpy needs permission to read your orders (status and tracking, no customer details). Reconnect your store once to allow it.</p>
          <ConnectShopify />
        </div>
      ) : error ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm">{error}</p>
      ) : !result ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="w-4 h-4" /> Reading your orders from Shopify…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="To ship" value={s!.toShip} active={filter === "ship"} onClick={() => setFilter("ship")} />
            <Tile label="Needs a look" value={s!.needsLook} warn={s!.needsLook > 0} active={filter === "look"} onClick={() => setFilter("look")} />
            <Tile label="On the way" value={s!.onTheWay} active={filter === "way"} onClick={() => setFilter("way")} />
            <Tile label="Delivered" value={s!.delivered} active={filter === "delivered"} onClick={() => setFilter("delivered")} />
          </div>

          {shipsNothing ? (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
              <p className="font-medium flex items-center gap-2"><Store className="w-4 h-4 text-primary" /> How do you ship your orders?</p>
              <p className="text-muted-foreground">
                Use whatever suits you: your agent, or a fulfillment app from the Shopify App Store. It places the orders with the supplier and
                adds the tracking in Shopify, and they show up here.
              </p>
              <div className="flex flex-wrap gap-2">
                {APPS.map((a) => (
                  <a key={a.name} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
                    {a.name} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          ) : s!.apps.length ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Shipped through {s!.apps.join(", ")}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <FilterSelect label="Show" value={filter} onChange={setFilter} options={FILTERS} active={filter !== "all"} />
            <span className="text-xs text-muted-foreground">
              Late = paid and not shipped after {LATE_DAYS} days{result.capped ? " · showing the newest 300" : ""}
            </span>
          </div>

          {list.length ? (
            <ul className="rounded-xl border border-border bg-card divide-y divide-border">
              {list.map((o) => <OrderRow key={o.id} order={o} />)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{result.orders.length ? "No orders in this view." : "No orders in the last 30 days."}</p>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, warn, active, onClick }: { label: string; value: number; warn?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={!!active} onClick={onClick} className="rounded-xl border border-border bg-card p-3 text-left hover:bg-muted/50">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold", warn && "text-warn")}>{value}</div>
    </button>
  );
}

function OrderRow({ order: o }: { order: TrackedOrder }) {
  const st = STATUS[o.status];
  return (
    <li className="p-3 space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {o.name} <span className="text-muted-foreground font-normal">· {date(o.createdAt)}{money(o.total) ? ` · ${money(o.total)}` : ""}</span>
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.tone)}>{st.label}</span>
      </div>
      {o.items.length ? <p className="text-xs text-muted-foreground truncate">{o.items.join(", ")}</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {o.handledBy.length ? <span className="text-muted-foreground">Handled by {o.handledBy.join(", ")}</span> : null}
        {o.tracking.map((t) =>
          t.url ? (
            <a key={t.number} href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <Truck className="w-3 h-3" aria-hidden="true" /> {t.company ? `${t.company} ` : ""}{t.number}
            </a>
          ) : (
            <span key={t.number} className="inline-flex items-center gap-1"><Truck className="w-3 h-3" aria-hidden="true" /> {t.company ? `${t.company} ` : ""}{t.number}</span>
          ),
        )}
        {o.deliveredAt ? <span className="text-good">Delivered {date(o.deliveredAt)}</span> : null}
      </div>
      {o.warning ? (
        <p className="text-xs text-warn flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {o.warning}</p>
      ) : null}
    </li>
  );
}
