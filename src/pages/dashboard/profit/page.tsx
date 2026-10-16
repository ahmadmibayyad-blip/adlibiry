import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { PiggyBank, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Profit (convex/profit.ts): the user's own Shopify store, day by day: orders and sales minus product cost,
// shipping, payment fees and the ad spend they enter. Updated hourly; Refresh recounts the last 30 days.

export default function ProfitPage() {
  const data = useQuery(api.profit.mine, { days: 30 });
  const refresh = useAction(api.profit.refresh);
  const setAdSpend = useMutation(api.profit.setAdSpend);
  const [busy, setBusy] = useState(false);
  const firstLoad = useRef(false);

  const run = async (quiet = false) => {
    setBusy(true);
    try {
      const r = await refresh({});
      if (!quiet) toast.success("days" in r ? "Up to date" : "Nothing to count yet");
    } catch (e) {
      if (!quiet) toast.error(errorMessage(e, "Couldn't read your orders"));
    } finally {
      setBusy(false);
    }
  };

  // Nothing counted yet: count the last 30 days once.
  const store = data && "store" in data ? data.store : null;
  const days = useMemo(() => (data && "days" in data ? (data.days ?? []) : []), [data]);
  useEffect(() => {
    if (store?.canRead && days.length === 0 && !firstLoad.current) {
      firstLoad.current = true;
      void run(true);
    }
  }, [store?.canRead, days.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === undefined) return <div className="p-6"><Spinner className="w-5 h-5" /></div>;
  if (!data) return null;

  const currency = store?.currency ?? "USD";
  const fmt = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);
  const sum = (list: typeof days) => ({
    orders: list.reduce((s, d) => s + d.orders, 0),
    revenue: list.reduce((s, d) => s + d.revenue, 0),
    profit: list.reduce((s, d) => s + d.profit, 0),
    ads: list.reduce((s, d) => s + (d.adSpend ?? 0), 0),
  });
  const newest = [...days].reverse();
  const yesterday = newest[1] ?? newest[0];
  const week = sum(newest.slice(0, 7));
  const month = sum(newest);
  const missing = days.reduce((s, d) => s + d.missingCost, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PiggyBank className="w-6 h-6 text-primary" /> Profit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What your store really makes each day: sales minus product cost, shipping, payment fees and ad spend. Updated every hour, and in your morning email.
          </p>
        </div>
        {store?.canRead ? (
          <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />} Refresh
          </Button>
        ) : null}
      </div>

      {!store ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>Connect your Shopify store to see its profit.</p>
          <ConnectShopify />
        </div>
      ) : !store.canRead ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>To count profit, AdSpy needs to read your orders (totals and items only, not who bought). Reconnect your store once to allow it.</p>
          <ConnectShopify />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: yesterday ? `Yesterday (${yesterday.day})` : "Yesterday", v: yesterday ? { orders: yesterday.orders, revenue: yesterday.revenue, profit: yesterday.profit, ads: yesterday.adSpend ?? 0 } : null },
              { label: "Last 7 days", v: week },
              { label: "Last 30 days", v: month },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                {c.v ? (
                  <>
                    <div className={cn("text-2xl font-bold mt-1", c.v.profit >= 0 ? "text-good" : "text-destructive")}>{fmt(c.v.profit)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">profit · {c.v.orders} orders · {fmt(c.v.revenue)} sales{c.v.ads ? ` · ${fmt(c.v.ads)} ads` : ""}</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground mt-1">{busy ? "Counting…" : "No orders yet"}</div>
                )}
              </div>
            ))}
          </div>

          {missing ? (
            <p className="text-sm text-warn">
              {missing} sold item{missing === 1 ? " has" : "s have"} no cost, so profit looks higher than it is. Set "Cost per item" on those products in Shopify, or sell them through the{" "}
              <Link to="/dashboard/orders" className="underline">CJ order autopilot</Link>.
            </p>
          ) : null}

          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  {["Day", "Orders", "Sales", "Products", "Shipping", "Fees", "Ad spend", "Profit"].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {newest.map((d) => (
                  <tr key={d.day} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{d.day}</td>
                    <td className="px-3 py-2">{d.orders}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(d.revenue)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(d.productCost)}{d.missingCost ? <span className="text-warn"> +?</span> : null}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(d.shippingCost)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(d.fees)}</td>
                    <td className="px-3 py-1">
                      <Input
                        key={`${d.day}-${d.adSpend ?? ""}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={d.adSpend ?? ""}
                        placeholder="Add"
                        className="h-8 w-24"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const amount = raw === "" ? null : Number(raw);
                          if (amount === (d.adSpend ?? null) || (amount !== null && !Number.isFinite(amount))) return;
                          void setAdSpend({ day: d.day, amount }).catch((err: unknown) => toast.error(errorMessage(err, "Couldn't save the ad spend")));
                        }}
                      />
                    </td>
                    <td className={cn("px-3 py-2 font-semibold whitespace-nowrap", d.profit >= 0 ? "text-good" : "text-destructive")}>{fmt(d.profit)}</td>
                  </tr>
                ))}
                {!newest.length ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{busy ? "Counting your orders…" : "No orders in the last 30 days."}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {data && "settings" in data && data.settings ? <CostSettings settings={data.settings} currency={currency} /> : null}
        </>
      )}
    </div>
  );
}

function CostSettings({ settings, currency }: { settings: { feePercent: number; feeFixed: number; shippingPerOrder: number }; currency: string }) {
  const save = useMutation(api.profit.setSettings);
  const refresh = useAction(api.profit.refresh);
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="rounded-xl border border-border bg-card p-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save(form);
          await refresh({});
          toast.success("Saved and recounted");
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't save"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-sm font-semibold">How costs are counted</h2>
      <p className="text-xs text-muted-foreground">
        Product cost: Shopify's "Cost per item" on each product, else the supplier cost AdSpy knows for products you launched, else what CJ charged when the autopilot sent it.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium">Payment fee (%)</span>
          <Input type="number" step="0.1" min="0" value={form.feePercent} onChange={(e) => setForm({ ...form, feePercent: Number(e.target.value) })} className="mt-1" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Fee per order ({currency})</span>
          <Input type="number" step="0.01" min="0" value={form.feeFixed} onChange={(e) => setForm({ ...form, feeFixed: Number(e.target.value) })} className="mt-1" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Shipping you pay per order ({currency})</span>
          <Input type="number" step="0.01" min="0" value={form.shippingPerOrder} onChange={(e) => setForm({ ...form, shippingPerOrder: Number(e.target.value) })} className="mt-1" />
        </label>
      </div>
      <Button type="submit" size="sm" disabled={busy}>{busy ? <Spinner className="w-4 h-4 mr-2" /> : null}Save and recount</Button>
    </form>
  );
}
