import { useEffect, useRef, useState } from "react";
import { Authenticated, useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, Eye, FileText, Paintbrush, Rocket, Store } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { STORE_STYLES, type StoreStyleId } from "@/convex/lib/storeStyles.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import StylePicker from "./StylePicker.tsx";

// Launch (convex/launch.ts): the product becomes a written, priced product
// page in the user's Shopify store, plus an ad kit from its winning ads. Full
// store also builds the home page, pages, menus and a styled theme around it.

const LANGUAGES: Record<string, string> = {
  en: "English", da: "Danish", de: "German", sv: "Swedish", nb: "Norwegian", no: "Norwegian", fr: "French", es: "Spanish",
  nl: "Dutch", it: "Italian", pl: "Polish", fi: "Finnish", pt: "Portuguese",
};
const TONES = [
  ["friendly", "Friendly"],
  ["premium", "Premium"],
  ["bold", "Bold"],
] as const;
const SELECT = "mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm";

const STORE_STEPS = [
  ["generating", "Writing your store from the ads that are winning"],
  ["product", "Creating the product"],
  ["pages", "Adding pages and menus"],
  ["theme", "Installing your theme"],
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

function StoreSteps({ l }: { l: Doc<"launches"> }) {
  const at = l.status === "generating" ? 0 : Math.max(1, STORE_STEPS.findIndex(([k]) => k === l.step));
  return (
    <ol className="space-y-2.5 py-4 text-sm">
      {STORE_STEPS.map(([key, label], i) => (
        <li key={key} className={cn("flex items-center gap-2.5", i > at && "text-muted-foreground")}>
          {i < at ? <Check className="w-4 h-4 text-primary" /> : i === at ? <Spinner className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border border-border" />}
          {label}
          {i === at && key === "theme" ? <span className="text-xs text-muted-foreground">(up to a minute)</span> : null}
        </li>
      ))}
    </ol>
  );
}

function GoLive({ l }: { l: Doc<"launches"> }) {
  const publish = useMutation(api.launch.publishTheme);
  const [confirm, setConfirm] = useState(false);
  if (l.themeLive) {
    return (
      <p className="flex items-center gap-2 text-sm text-good">
        <Check className="w-4 h-4" /> It's your live theme now.
      </p>
    );
  }
  if (l.step === "going-live") {
    return (
      <p className="flex items-center gap-2 text-sm">
        <Spinner className="w-4 h-4" /> Making it your live theme…
      </p>
    );
  }
  return confirm ? (
    <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
      <p>This replaces the theme your customers see now. Your old theme stays in Shopify → Online Store → Themes, so you can switch back.</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await publish({ launchId: l._id });
            } catch (err) {
              toast.error(errorMessage(err, "Couldn't publish the theme"));
            }
            setConfirm(false);
          }}
        >
          Yes, make it live
        </Button>
        <Button size="sm" variant="outline" onClick={() => setConfirm(false)}>Not yet</Button>
      </div>
    </div>
  ) : (
    <Button variant="outline" onClick={() => setConfirm(true)}>
      <Rocket className="w-4 h-4 mr-2" />
      Make it my live store
    </Button>
  );
}

function Progress({ launchId, onAgain }: { launchId: Id<"launches">; onAgain: () => void }) {
  const l = useQuery(api.launch.get, { launchId });
  if (!l) return <Spinner />;
  const isStore = l.mode === "store";
  if (l.status === "generating" || l.status === "publishing") {
    return isStore ? (
      <StoreSteps l={l} />
    ) : (
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
      {isStore ? (
        <>
          <p className="text-sm">
            <strong>{l.brandName}</strong> is ready in the {STORE_STYLES[l.style as StoreStyleId]?.name ?? ""} style: home page, product page, cart, About,
            FAQ, Shipping &amp; returns and Contact. It's installed as a new theme, so your current store doesn't change until you make it live.
          </p>
          <div className="flex flex-wrap gap-2">
            {l.themePreviewUrl && (
              <Button asChild>
                <a href={l.themePreviewUrl} target="_blank" rel="noopener noreferrer"><Eye className="w-4 h-4 mr-2" />Preview store</a>
              </Button>
            )}
            {l.themeEditorUrl && (
              <Button asChild variant="outline">
                <a href={l.themeEditorUrl} target="_blank" rel="noopener noreferrer"><Paintbrush className="w-4 h-4 mr-2" />Customize</a>
              </Button>
            )}
            {l.adminUrl && (
              <Button asChild variant="ghost">
                <a href={l.adminUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" />Product in Shopify</a>
              </Button>
            )}
          </div>
          <GoLive l={l} />
          {l.error ? <p className="text-sm text-bad">{l.error}</p> : null}
          <p className="text-xs text-muted-foreground">
            Checkout is Shopify's own secure checkout. Set up payments, shipping rates and your legal policies in Shopify Settings before you run ads.
          </p>
        </>
      ) : (
        <>
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
        </>
      )}
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

function ModeSwitch({ mode, onChange }: { mode: "page" | "store"; onChange: (m: "page" | "store") => void }) {
  const options = [
    ["page", FileText, "Product page", "Add one product to your current store"],
    ["store", Store, "Full store", "Home, product, cart and pages in a new design"],
  ] as const;
  return (
    <div role="radiogroup" aria-label="What to launch" className="grid grid-cols-2 gap-2">
      {options.map(([value, Icon, title, sub]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-foreground/30",
          )}
        >
          <Icon className={cn("w-4 h-4 mb-1.5", mode === value ? "text-primary" : "text-muted-foreground")} />
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground leading-snug">{sub}</div>
        </button>
      ))}
    </div>
  );
}

function LaunchButton({ product }: { product: Doc<"products"> }) {
  const [open, setOpen] = useState(false);
  const prep = useQuery(api.launch.prepare, open ? { productId: product._id } : "skip");
  const status = useQuery(api.shopifyApp.status, open ? {} : "skip");
  const start = useMutation(api.launch.start);
  const refreshStoreInfo = useAction(api.shopifyImport.refreshStoreInfo);
  const refreshed = useRef(false);
  // Stores whose currency, language or name we don't have yet: read them once, so the price is in the store's currency.
  useEffect(() => {
    if (prep?.store && !prep.store.infoComplete && !refreshed.current) {
      refreshed.current = true;
      refreshStoreInfo({}).catch(() => {});
    }
  }, [prep?.store, refreshStoreInfo]);
  // null: not touched yet, so the suggested price and the store's language apply.
  const [priceInput, setPrice] = useState<string | null>(null);
  const [languageInput, setLanguage] = useState<string | null>(null);
  const [tone, setTone] = useState<(typeof TONES)[number][0]>("friendly");
  const [publishInput, setPublish] = useState<"DRAFT" | "ACTIVE" | null>(null);
  const [mode, setMode] = useState<"page" | "store">("store");
  const [style, setStyle] = useState<StoreStyleId>("fresh");
  const [brandInput, setBrand] = useState<string | null>(null);
  const [shippingTime, setShippingTime] = useState("5–10 business days");
  const [returnDays, setReturnDays] = useState("30");
  const [freeShipping, setFreeShipping] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [launchId, setLaunchId] = useState<Id<"launches"> | null>(null);
  const [busy, setBusy] = useState(false);

  const price = priceInput ?? (prep?.suggested.price ? String(prep.suggested.price) : "");
  const language = languageInput ?? (prep?.store?.locale ? (LANGUAGES[prep.store.locale.slice(0, 2)] ?? "English") : "English");
  const brand = brandInput ?? prep?.store?.shopName ?? "";
  // A full store shows the product on its home page, so it goes live by default (the store itself can stay password-protected).
  const publish = publishInput ?? (mode === "store" ? "ACTIVE" : "DRAFT");
  // A launch of this product still running from before shows its progress.
  const stillRunning = prep?.last && (prep.last.status === "generating" || prep.last.status === "publishing") ? prep.last._id : null;
  const shownLaunch = launchId ?? stillRunning;
  const needsReconnect = mode === "store" && (prep?.store?.missingStoreScopes?.length ?? 0) > 0;

  const cost = prep?.suggested.cost;
  const priceNum = Number(price);
  const margin = cost && priceNum > 0 ? Math.round(((priceNum - cost) / priceNum) * 100) : undefined;
  const currency = prep?.store?.currency ?? "USD";

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Rocket className="w-4 h-4 mr-2" />
        Launch
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setLaunchId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Launch to Shopify</DialogTitle>
            <DialogDescription>Written from the ads already selling it, priced from the real supplier cost.</DialogDescription>
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
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const days = Number(returnDays);
                  const free = Number(freeShipping);
                  const r = await start({
                    productId: product._id,
                    language,
                    tone,
                    publish,
                    ...(priceNum > 0 ? { price: priceNum } : {}),
                    ...(mode === "store"
                      ? {
                          mode,
                          style,
                          brandName: brand,
                          facts: {
                            shippingTime,
                            returnDays: Number.isFinite(days) ? days : 30,
                            ...(free > 0 ? { freeShippingFrom: free } : {}),
                            ...(supportEmail.trim() ? { supportEmail: supportEmail.trim() } : {}),
                          },
                        }
                      : {}),
                  });
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

              <ModeSwitch mode={mode} onChange={setMode} />

              {mode === "store" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Pick a style</h3>
                  <StylePicker value={style} onChange={setStyle} brand={brand} imageUrl={product.imageUrl || undefined} />
                  <p className="text-xs text-muted-foreground">You can change colors, fonts and sections afterwards in Shopify's theme editor.</p>
                </section>
              )}

              {mode === "store" && !prep.store.viaApp && !needsReconnect ? (
                <p className="text-xs text-muted-foreground">
                  Your store is connected with a custom-app token. It needs the theme, page and navigation permissions for a full store:{" "}
                  <Link to="/dashboard/settings" className="text-primary hover:underline">Settings → Shopify → Update token</Link>.
                </p>
              ) : null}

              {needsReconnect ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
                  <p>Building a full store needs permission to add a theme, pages and menus. Reconnect your store once to approve it.</p>
                  <ConnectShopify />
                </div>
              ) : null}

              {mode === "store" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Your store</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block text-sm">
                      <span className="font-medium">Store name</span>
                      <Input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} className="mt-1" />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium">Support email</span>
                      <Input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="Optional" className="mt-1" />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium">Delivery time</span>
                      <Input value={shippingTime} onChange={(e) => setShippingTime(e.target.value)} maxLength={60} className="mt-1" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="font-medium">Returns (days)</span>
                        <Input type="number" min="0" max="365" value={returnDays} onChange={(e) => setReturnDays(e.target.value)} className="mt-1" />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium">Free shipping from</span>
                        <Input type="number" min="0" step="1" value={freeShipping} onChange={(e) => setFreeShipping(e.target.value)} placeholder={`${currency}, optional`} className="mt-1" />
                      </label>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">The AI only promises what you enter here on the shipping, returns and FAQ pages.</p>
                </section>
              )}

              <section className="space-y-3">
                {mode === "store" && <h3 className="text-sm font-semibold">Product</h3>}
                <label className="block text-sm">
                  <span className="font-medium">Price ({currency})</span>
                  <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
                  <span className="text-xs text-muted-foreground">
                    {cost ? `Supplier cost ${cost.toFixed(2)} ${currency} incl. shipping · margin ${margin ?? "–"}%` : "No supplier cost known: check your margin."}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="font-medium">Language</span>
                    <select className={SELECT} value={language} onChange={(e) => setLanguage(e.target.value)}>
                      {[...new Set(Object.values(LANGUAGES))].map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Tone</span>
                    <select className={SELECT} value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
                      {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={publish === "ACTIVE"} onChange={(e) => setPublish(e.target.checked ? "ACTIVE" : "DRAFT")} />
                  {mode === "store" ? "Make the product active (needed for it to show on the new home page)" : "Publish it live now (otherwise it's saved as a draft for you to check)"}
                </label>
              </section>

              <Button type="submit" className="w-full" disabled={busy || needsReconnect}>
                {busy ? <Spinner /> : <Rocket className="w-4 h-4 mr-2" />}
                {mode === "store" ? `Build my ${STORE_STYLES[style].name} store` : "Write and launch"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                The AI only uses real facts: no invented reviews, sales numbers or health claims. Check the{mode === "store" ? " store" : " page"} before you run ads.
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
