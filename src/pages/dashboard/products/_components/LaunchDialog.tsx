import { useEffect, useRef, useState } from "react";
import { Authenticated, useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, CopyCheck, ExternalLink, Eye, FileText, Paintbrush, Rocket, Store } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { BASE_THEME_NAMES, STORE_STYLES, type BaseTheme, type StoreStyleId } from "@/convex/lib/storeStyles.ts";
import type { SupplierReviews } from "@/convex/lib/supplierReviews.ts";
import type { PageMirror } from "@/convex/lib/pageMirror.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import StoreCheck from "@/components/StoreCheck.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import AdKit from "./AdKit.tsx";
import StylePicker from "./StylePicker.tsx";

// Launch (convex/launch.ts): the product becomes a written, priced product
// page in the user's Shopify store, plus an ad kit from its winning ads. Full
// store also builds the home page, pages, menus and a styled theme around it.

const LANGUAGES: Record<string, string> = {
  en: "English", da: "Danish", de: "German", sv: "Swedish", nb: "Norwegian", no: "Norwegian", fr: "French", es: "Spanish",
  nl: "Dutch", it: "Italian", pl: "Polish", fi: "Finnish", pt: "Portuguese",
};
// When we can't read the store's language (needs read_locales), its currency is a good guess.
const CURRENCY_LANGUAGE: Record<string, string> = { DKK: "Danish", SEK: "Swedish", NOK: "Norwegian", PLN: "Polish", GBP: "English", USD: "English" };
const TONES = [
  ["friendly", "Friendly"],
  ["premium", "Premium"],
  ["bold", "Bold"],
] as const;
const SELECT = "mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm";

const AI_PHOTO_COUNTS = [0, 2, 4, 6] as const;

const STORE_STEPS = [
  ["generating", "Writing your store from the ads that are winning"],
  ["photos", "Making AI product photos"],
  ["product", "Creating the product"],
  ["pages", "Adding pages and menus"],
  ["theme", "Installing your theme"],
] as const;

function StoreSteps({ l }: { l: Doc<"launches"> }) {
  const steps = STORE_STEPS.filter(([k]) => k !== "photos" || (l.aiPhotos ?? 0) > 0);
  const at = l.status === "generating" ? 0 : Math.max(1, steps.findIndex(([k]) => k === l.step));
  return (
    <ol className="space-y-2.5 py-4 text-sm">
      {steps.map(([key, label], i) => (
        <li key={key} className={cn("flex items-center gap-2.5", i > at && "text-muted-foreground")}>
          {i < at ? <Check className="w-4 h-4 text-primary" /> : i === at ? <Spinner className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border border-border" />}
          {label}
          {i === at && (key === "theme" || key === "photos") ? <span className="text-xs text-muted-foreground">(up to a minute)</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** The AI photos a launch made: also in the Shopify product, and handy for ads. */
function AiPhotos({ l }: { l: Doc<"launches"> }) {
  if (!l.aiPhotos) return null;
  const urls = l.aiPhotoUrls ?? [];
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">AI product photos</h4>
      {urls.length ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {urls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img src={u} alt={`AI photo ${i + 1}`} className="aspect-square w-full rounded-md border border-border object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground mt-1.5">
        {l.aiPhotoNote ?? "Added to the product in Shopify. Open one to save it for your ads."}
      </p>
    </div>
  );
}

/** What the AI couldn't verify: for the owner to check before going live (never on the page). */
function Checks({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-lg border border-warn/30 bg-warn/5 p-3">
      <h4 className="text-sm font-semibold mb-1.5">Check before you go live</h4>
      <ul className="space-y-1 text-xs list-disc pl-4">
        {items.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-1.5">The page only says what we could verify. Add these details in Shopify once you've confirmed them with your supplier.</p>
    </div>
  );
}

/** What the supplier reviews added to the store, and why there are few or none. */
function ReviewsResult({ reviews, note }: { reviews?: SupplierReviews; note?: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {reviews ? `Supplier reviews added: ${reviews.items.length} written, ${reviews.average}★ from ${reviews.total} buyers. ` : ""}
      {note ?? ""}
    </p>
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

/** What "Copy a page's layout" took from the page, and what it left out. */
function MirrorResult({ mirror }: { mirror: PageMirror }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
      <p className="font-medium flex items-center gap-1.5">
        <CopyCheck className="w-4 h-4 text-primary" /> Layout copied from {mirror.host}
      </p>
      {mirror.copied.length ? (
        <ul className="space-y-1 text-xs">
          {mirror.copied.map((x) => (
            <li key={x} className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />{x}</li>
          ))}
        </ul>
      ) : null}
      {mirror.skipped.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
          {mirror.skipped.map((x) => <li key={x}>{x}</li>)}
        </ul>
      ) : null}
      <p className="text-[11px] text-muted-foreground">Only the structure is copied. The text and photos are your own, written and made for your product.</p>
    </div>
  );
}

export function Progress({ launchId, onAgain }: { launchId: Id<"launches">; onAgain: () => void }) {
  const l = useQuery(api.launch.get, { launchId });
  const quota = useQuery(api.launch.myQuota, {});
  if (!l) return <Spinner />;
  const isStore = l.mode === "store";
  if (l.status === "generating" || l.status === "publishing") {
    return isStore ? (
      <StoreSteps l={l} />
    ) : (
      <div className="flex flex-col items-center gap-3 py-8 text-sm">
        <Spinner className="w-6 h-6" />
        {l.status === "generating" ? "Writing your page from the ads that are winning…" : l.step === "photos" ? "Making AI product photos…" : "Creating it in your Shopify store…"}
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
            <strong>{l.brandName}</strong> is ready in the {STORE_STYLES[l.style as StoreStyleId]?.name ?? ""} style{l.baseTheme === "dawn" ? " on Dawn" : ""}: home page, product page, cart, About,
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
          {l.reviewsUrl ? <ReviewsResult reviews={l.reviews as SupplierReviews | undefined} note={l.reviewsNote} /> : null}
          {l.mirror ? <MirrorResult mirror={l.mirror as PageMirror} /> : null}
          {l.bundleOff ? (
            <p className="text-xs text-muted-foreground">
              Bundle deals on the product page:{" "}
              {l.bundleOff
                .map((off, i) => ({ off, qty: l.bundleQty?.[i] ?? i + 1 }))
                .filter((d) => d.off > 0)
                .map((d) => `${d.qty} ${d.qty === 1 ? "item" : "items"} −${d.off}%`)
                .join(", ")}
              , with matching automatic discounts in Shopify.
            </p>
          ) : l.bundlesNote ? (
            <p className="text-xs text-muted-foreground">{l.bundlesNote}</p>
          ) : null}
          {l.marginNote ? <p className="text-xs text-warn">{l.marginNote}</p> : null}
          <div className="rounded-lg border border-border p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm">Before you run ads, check that the store can take real orders.</p>
            <StoreCheck variant="default" label="Is my store ready to sell?" />
          </div>
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
      <Checks items={(l.copy as { checks?: string[] } | undefined)?.checks} />
      <AiPhotos l={l} />
      <AdKit l={l} ready={!!quota?.aiPhotosReady} />
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

/** The theme a Full store is built on (convex/lib/storeStyles.ts BASE_THEMES). */
function ThemeSwitch({ value, onChange }: { value: BaseTheme; onChange: (t: BaseTheme) => void }) {
  const options = [
    ["adspy", "Cart drawer with free-shipping bar and delivery dates, sticky add-to-cart, quantity deals, sale countdown"],
    ["dawn", "Shopify's free default theme: fast, familiar, works with every app"],
  ] as const;
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
      {options.map(([id, sub]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-foreground/30",
          )}
        >
          <div className="text-sm font-medium">{BASE_THEME_NAMES[id]}{id === "adspy" ? " (recommended)" : ""}</div>
          <div className="text-xs text-muted-foreground leading-snug">{sub}</div>
        </button>
      ))}
    </div>
  );
}

/** What the dialog needs: a catalog product, or one pasted as a link (convex/productImport.ts). */
type LaunchTarget = { _id: Id<"products"> | Id<"importedProducts">; imageUrl: string };

function LaunchButton({ product, startOpen, onClose, mirrorUrl: mirrorStart }: { product: LaunchTarget; startOpen?: boolean; onClose?: () => void; mirrorUrl?: string }) {
  const [open, setOpen] = useState(!!startOpen);
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
  const [baseTheme, setBaseTheme] = useState<BaseTheme>("adspy");
  const [brandInput, setBrand] = useState<string | null>(null);
  const [shippingTime, setShippingTime] = useState("5–10 business days");
  const [returnDays, setReturnDays] = useState("30");
  const [freeShipping, setFreeShipping] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [aiPhotosInput, setAiPhotos] = useState<number | null>(null);
  const [reviewsInput, setReviewsUrl] = useState<string | null>(null);
  const [mirrorUrl, setMirrorUrl] = useState(mirrorStart ?? "");
  const [launchId, setLaunchId] = useState<Id<"launches"> | null>(null);
  const [busy, setBusy] = useState(false);

  const price = priceInput ?? (prep?.suggested.price ? String(prep.suggested.price) : "");
  const aiPhotos = prep?.aiPhotosReady ? (aiPhotosInput ?? 4) : 0;
  const reviewsUrl = reviewsInput ?? prep?.supplierUrl ?? "";
  const storeLocale = prep?.store?.locale && prep.store.locale !== "en" ? prep.store.locale.slice(0, 2) : undefined;
  const language = languageInput ?? (storeLocale && LANGUAGES[storeLocale]) ?? CURRENCY_LANGUAGE[prep?.store?.currency ?? ""] ?? "English";
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
      {!startOpen && (
        <Button onClick={() => setOpen(true)}>
          <Rocket className="w-4 h-4 mr-2" />
          Launch
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setLaunchId(null); onClose?.(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Launch to Shopify</DialogTitle>
            <DialogDescription>
              {prep?.imported
                ? "Written from the product's page, priced from what we could read. Check the price before you build."
                : "Written from the ads already selling it, priced from the real supplier cost."}
            </DialogDescription>
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
                    ...(aiPhotos > 0 ? { aiPhotos } : {}),
                    ...(mode === "store" && reviewsUrl.trim() ? { reviewsUrl: reviewsUrl.trim() } : {}),
                    ...(mode === "store" && mirrorUrl.trim() ? { mirrorUrl: mirrorUrl.trim() } : {}),
                    ...(mode === "store"
                      ? {
                          mode,
                          style,
                          baseTheme,
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
              {mode === "page" && mirrorUrl.trim() ? (
                <p className="text-xs text-warn -mt-2">
                  Copying {mirrorUrl.replace(/^https?:\/\/(www\.)?/, "").split(/[/?]/)[0]}'s layout needs Full store. Switch back to keep it; a single product page
                  launches without it.
                </p>
              ) : null}

              {mode === "store" && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Theme</h3>
                  <ThemeSwitch value={baseTheme} onChange={setBaseTheme} />
                  <h3 className="text-sm font-semibold pt-1">Pick a style</h3>
                  <StylePicker value={style} onChange={setStyle} brand={brand} imageUrl={product.imageUrl || undefined} />
                  <p className="text-xs text-muted-foreground">You can change colors, fonts and sections afterwards in Shopify's theme editor.</p>
                  <label className="block text-sm">
                    <span className="font-medium flex items-center gap-1.5"><CopyCheck className="w-4 h-4 text-primary" /> Copy a page's layout</span>
                    <Input
                      type="url"
                      value={mirrorUrl}
                      onChange={(e) => setMirrorUrl(e.target.value)}
                      placeholder="A product page that sells well, optional: https://store.com/products/…"
                      className="mt-1"
                    />
                    <span className="text-xs text-muted-foreground">
                      Your product page gets that page's section order, bundle deals and buy-box extras. Never its text, photos or reviews: those are
                      written and made for your product. Fake countdowns aren't copied.
                    </span>
                  </label>
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
                  <Input type="number" min="0.01" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
                  <span className="text-xs text-muted-foreground">
                    {cost
                      ? `Supplier cost ${cost.toFixed(2)} ${currency} incl. shipping · margin ${margin ?? "–"}%`
                      : prep.suggested.price
                        ? "No supplier cost known: check your margin."
                        : "We couldn't tell a sensible price from this product's data: enter yours."}
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
                <div className="text-sm">
                  <span className="font-medium">AI product photos</span>
                  <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label="AI product photos">
                    {AI_PHOTO_COUNTS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={aiPhotos === n}
                        disabled={!prep.aiPhotosReady}
                        onClick={() => setAiPhotos(n)}
                        className={cn(
                          "h-8 min-w-12 rounded-md border px-3 text-sm disabled:opacity-50",
                          aiPhotos === n ? "border-primary bg-primary/10 font-medium text-foreground" : "border-input text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {n === 0 ? "None" : n}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {prep.aiPhotosReady
                      ? "New photos made from the product photo: in use, close-ups and lifestyle scenes. They go on the product page and you can use them in ads."
                      : "AI photos aren't switched on yet."}
                  </span>
                </div>
                {mode === "store" && (
                  <label className="block text-sm">
                    <span className="font-medium">Supplier reviews</span>
                    <textarea
                      value={reviewsUrl}
                      onChange={(e) => setReviewsUrl(e.target.value)}
                      placeholder="AliExpress product links, one per line (up to 3), optional"
                      rows={2}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">
                      Real reviews from buyers of this product on AliExpress, translated and shown on your home and product pages as reviews from your
                      supplier's buyers. Pick listings with many written reviews, or add up to 3 sellers of the same product for more.
                    </span>
                    {reviewsUrl.split(/\s+/).some((x) => x && !/aliexpress\./i.test(x)) ? (
                      <span className="block text-xs text-warn mt-1">
                        Only AliExpress links work here. Another store's reviews were written by its own customers about its shop, so they can't
                        be shown as yours.
                      </span>
                    ) : null}
                  </label>
                )}
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

export default function LaunchDialog({ product, startOpen, onClose, mirrorUrl }: { product: LaunchTarget; startOpen?: boolean; onClose?: () => void; mirrorUrl?: string }) {
  return (
    <Authenticated>
      <LaunchButton product={product} startOpen={startOpen} onClose={onClose} mirrorUrl={mirrorUrl} />
    </Authenticated>
  );
}
