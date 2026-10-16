import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, ExternalLink, Link2, PackageCheck, RefreshCw, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { CjMatch, CjVariantOption } from "@/convex/lib/cj.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import ProductImage from "@/components/ProductImage.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { price } from "@/lib/money.ts";
import { cn } from "@/lib/utils.ts";

// Orders (convex/orders.ts): the CJ order autopilot. Paid Shopify orders come in every 30 minutes; once every item
// is linked to a CJ product, the order waits for Approve, then goes to CJ; CJ's tracking number goes back to
// Shopify, which emails the customer. Nothing is ordered without the user's click.

type Page = NonNullable<FunctionReturnType<typeof api.orders.mine>>;
type Order = Page["orders"][number];
type Item = Order["items"][number];

const GROUPS: { status: string[]; title: string; hint: string }[] = [
  { status: ["waiting", "failed"], title: "Waiting for your OK", hint: "Approve to create the order at CJ." },
  { status: ["needs_link", "quoting"], title: "Needs a CJ product", hint: "Link each item to the CJ product that ships it, once. Later orders of it come in linked." },
  { status: ["placing", "placed"], title: "At CJ", hint: "CJ ships it; the tracking number goes to Shopify by itself." },
  { status: ["shipped"], title: "Shipped", hint: "Shopify emailed the customer the tracking link." },
  { status: ["no_address", "rejected"], title: "Not via CJ", hint: "No shipping address, or you said no." },
];

export default function OrdersPage() {
  const data = useQuery(api.orders.mine, {});
  const setSettings = useMutation(api.orders.setSettings);
  const sync = useAction(api.orders.sync);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<Item | null>(null);

  if (data === undefined) return <div className="p-6"><Spinner className="w-5 h-5" /></div>;
  if (!data) return null;
  const { settings } = data;

  const check = async () => {
    setBusy(true);
    try {
      const r = await sync({});
      toast.success("added" in r ? (r.added ? `${r.added} new order${r.added === 1 ? "" : "s"}` : "No new orders") : `Not checked: ${r.skipped}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't read your orders"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PackageCheck className="w-6 h-6 text-primary" /> Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your Shopify orders, fulfilled through CJ Dropshipping: you approve each one, CJ ships it, and the customer gets the tracking link from Shopify.
          </p>
        </div>
        {data.store?.canUse && settings.autopilot ? (
          <Button variant="outline" size="sm" onClick={() => void check()} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />} Check for orders
          </Button>
        ) : null}
      </div>

      {!data.cjReady ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm">CJ isn't connected yet. The site owner adds the CJ API key (CJ_API_KEY) in the Convex settings.</p>
      ) : !data.store ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>Connect your Shopify store first.</p>
          <ConnectShopify />
        </div>
      ) : !data.store.canUse ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <p>The autopilot needs to read your orders (with the shipping address, to send to CJ) and add tracking numbers. Reconnect your store once to allow it.</p>
          <ConnectShopify />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Order autopilot</span>
              <span className="block text-xs text-muted-foreground">Brings in paid, unshipped orders from the last 14 days every 30 minutes. Nothing goes to CJ until you approve it.</span>
            </span>
            <Switch checked={settings.autopilot} onCheckedChange={(on) => void setSettings({ autopilot: on, payFromBalance: settings.payFromBalance })} />
          </label>
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Pay from my CJ balance when I approve</span>
              <span className="block text-xs text-muted-foreground">Off: the order is created at CJ unpaid, and you pay it in your CJ account. On: CJ takes the money from your CJ balance right away.</span>
            </span>
            <Switch checked={settings.payFromBalance} onCheckedChange={(on) => void setSettings({ autopilot: settings.autopilot, payFromBalance: on })} />
          </label>
        </div>
      )}

      {GROUPS.map((g) => {
        const list = data.orders.filter((o) => g.status.includes(o.status));
        if (!list.length) return null;
        return (
          <section key={g.title} className="space-y-2">
            <h2 className="font-semibold">{g.title} <span className="text-muted-foreground font-normal">({list.length})</span></h2>
            <p className="text-xs text-muted-foreground -mt-1">{g.hint}</p>
            <ul className="space-y-2">
              {list.map((o) => <OrderCard key={o._id} order={o} payFromBalance={settings.payFromBalance} onLink={setLinking} />)}
            </ul>
          </section>
        );
      })}
      {data.store?.canUse && settings.autopilot && !data.orders.length ? <p className="text-sm text-muted-foreground">No orders yet. New paid orders show up here within 30 minutes.</p> : null}

      {data.links.length ? <Links links={data.links} /> : null}
      {linking ? <LinkDialog item={linking} onClose={() => setLinking(null)} /> : null}
    </div>
  );
}

function OrderCard({ order: o, payFromBalance, onLink }: { order: Order; payFromBalance: boolean; onLink: (i: Item) => void }) {
  const approve = useMutation(api.orders.approve);
  const reject = useMutation(api.orders.reject);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e, "That didn't work"));
    } finally {
      setBusy(false);
    }
  };
  const canDecide = o.status === "waiting" || o.status === "failed";
  return (
    <li className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{o.orderName} <span className="text-muted-foreground font-normal">· {o.shipToLabel ?? "no address"} · {new Date(o.createdAt).toLocaleDateString()}</span></span>
        {o.status === "quoting" ? <span className="text-xs text-muted-foreground flex items-center gap-1"><Spinner className="w-3 h-3" /> Getting CJ's shipping price…</span> : null}
        {o.status === "placing" ? <span className="text-xs text-muted-foreground flex items-center gap-1"><Spinner className="w-3 h-3" /> Sending to CJ…</span> : null}
      </div>
      <ul className="text-sm space-y-1">
        {o.items.map((i) => (
          <li key={i.lineItemId} className="flex flex-wrap items-center gap-2">
            <span>{i.quantity} × {i.title}</span>
            {i.cjVid ? <span className="text-xs text-muted-foreground">→ CJ: {i.cjName}</span> : (
              <Button size="sm" variant="outline" className="h-7" onClick={() => onLink(i)}><Link2 className="w-3.5 h-3.5 mr-1" /> Link to CJ</Button>
            )}
          </li>
        ))}
      </ul>
      {o.shipping && (o.status === "waiting" || o.status === "failed") ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> {o.shipping.method}: {price(o.shipping.priceUsd)} shipping{o.shipping.days ? `, ${o.shipping.days} days` : ""}, from China</p>
      ) : null}
      {o.cjOrderId ? (
        <p className="text-xs text-muted-foreground">
          CJ order {o.cjOrderId}{o.cjCostUsd !== undefined ? ` · ${price(o.cjCostUsd)}` : ""} ·{" "}
          <a href="https://cjdropshipping.com/myCJ.html" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">open in CJ <ExternalLink className="w-3 h-3" /></a>
        </p>
      ) : null}
      {o.tracking ? (
        <p className="text-xs">Tracking: {o.tracking.url ? <a href={o.tracking.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{o.tracking.number}</a> : o.tracking.number}{o.tracking.company ? ` (${o.tracking.company})` : ""}</p>
      ) : null}
      {o.error ? <p className="text-xs text-destructive">{o.error}</p> : null}
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !o.shipping} onClick={() => void act(() => approve({ id: o._id }), "Sent to CJ")}>
            <Check className="w-4 h-4 mr-1" /> {o.status === "failed" ? "Try again" : payFromBalance ? "Approve and pay from CJ balance" : "Approve"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => reject({ id: o._id }))}><X className="w-4 h-4 mr-1" /> Not via CJ</Button>
        </div>
      ) : null}
    </li>
  );
}

function Links({ links }: { links: Page["links"] }) {
  const unlink = useMutation(api.orders.unlink);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Linked products</h2>
      <ul className="rounded-xl border border-border bg-card divide-y divide-border">
        {links.map((l) => (
          <li key={l._id} className="flex items-center gap-3 p-2.5 text-sm">
            {l.cjImage ? <img src={l.cjImage} alt="" className="w-9 h-9 rounded object-cover" /> : null}
            <span className="min-w-0 flex-1">{l.title} <span className="text-muted-foreground">→ {l.cjName}</span></span>
            <Button size="sm" variant="ghost" onClick={() => void unlink({ id: l._id })}>Unlink</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const search = useAction(api.cj.searchProducts);
  const variantsOf = useAction(api.cj.variants);
  const link = useMutation(api.orders.link);
  const [q, setQ] = useState(item.title.replace(/\s*\(.*\)$/, ""));
  const [results, setResults] = useState<Omit<CjMatch, "similarity">[] | null>(null);
  const [picked, setPicked] = useState<Omit<CjMatch, "similarity"> | null>(null);
  const [variants, setVariants] = useState<CjVariantOption[] | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setBusy(true);
    setPicked(null);
    setVariants(null);
    try {
      setResults(await search({ keyword: q }));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (p: Omit<CjMatch, "similarity">) => {
    setPicked(p);
    setBusy(true);
    try {
      setVariants(await variantsOf({ pid: p.pid }));
    } finally {
      setBusy(false);
    }
  };
  const choose = async (v: CjVariantOption) => {
    if (!picked) return;
    setBusy(true);
    try {
      await link({ shopifyVariantId: item.variantId, title: item.title, cjPid: picked.pid, cjVid: v.vid, cjName: `${picked.title}${v.name && v.name !== picked.title ? ` (${v.name})` : ""}`, ...(v.imageUrl || picked.imageUrl ? { cjImage: v.imageUrl ?? picked.imageUrl } : {}) });
      toast.success("Linked: orders with it come in ready");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't link it"));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Link to a CJ product</DialogTitle>
          <DialogDescription>{item.title}: pick the CJ product and variant that ships it.</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
          <Button type="submit" disabled={busy || !q.trim()}>{busy && !picked ? <Spinner className="w-4 h-4" /> : <Search className="w-4 h-4" />}</Button>
        </form>
        {!picked && results ? (
          results.length ? (
            <ul className="divide-y divide-border">
              {results.map((p) => (
                <li key={p.pid}>
                  <button type="button" onClick={() => void pick(p)} className="w-full flex items-center gap-3 py-2 text-left hover:bg-muted/50 rounded px-1">
                    <ProductImage src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                    <span className="min-w-0 text-sm">
                      <span className="block line-clamp-1">{p.title}</span>
                      <span className="text-xs text-muted-foreground">{price(p.price)}{p.listed ? ` · listed by ${p.listed.toLocaleString("en-US")} stores` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nothing found on CJ. Try other words.</p>
        ) : null}
        {picked ? (
          <div className="space-y-2">
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPicked(null)}>← Back to the results</button>
            <p className="text-sm font-medium">{picked.title}: which variant?</p>
            {variants === null ? <Spinner className="w-4 h-4" /> : variants.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {variants.map((v) => (
                  <li key={v.vid}>
                    <button type="button" disabled={busy} onClick={() => void choose(v)} className={cn("w-full flex items-center gap-2 rounded-lg border border-border p-2 text-left text-sm hover:border-primary")}>
                      {v.imageUrl ? <img src={v.imageUrl} alt="" className="w-9 h-9 rounded object-cover" /> : null}
                      <span className="min-w-0"><span className="block line-clamp-2">{v.name}</span>{v.price ? <span className="text-xs text-muted-foreground">{price(v.price)}</span> : null}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">CJ lists no variants for it.</p>}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
