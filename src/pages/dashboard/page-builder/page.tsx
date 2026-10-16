import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Code2, Copy, Download, ExternalLink, Eye, ImageIcon, ImageUp, Monitor, ShoppingBag, Smartphone, Trash2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import LinkScreenshot from "@/components/LinkScreenshot.tsx";
import PageProducts, { type PickedProduct } from "./PageProducts.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { pastedImage, screenshotParts, type ScreenshotPart } from "@/lib/screenshotParts.ts";
import { cn } from "@/lib/utils.ts";

// Screenshot to page (convex/screenPagesAi.ts): upload a screenshot of a landing or product page and the AI
// builds it as one HTML file with Tailwind, to preview, change in plain words, copy or download.

type PageView = NonNullable<FunctionReturnType<typeof api.screenPages.get>>;

export default function PageBuilderPage() {
  const create = useAction(api.screenPagesAi.create);
  const mine = useQuery(api.screenPages.mine, {});
  const [params, setParams] = useSearchParams();
  const id = params.get("id") as Id<"screenPages"> | null;
  const page = useQuery(api.screenPages.get, id ? { id } : "skip");
  const input = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<{ parts: ScreenshotPart[]; preview: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Open the latest page when none is chosen.
  useEffect(() => {
    if (!id && mine?.pages[0]) setParams({ id: mine.pages[0]._id }, { replace: true });
  }, [id, mine, setParams]);

  const pick = async (file: Blob | null | undefined) => {
    if (!file) return;
    try {
      setShot(await screenshotParts(file));
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't read that image"));
    }
  };

  const make = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      const r = await create({
        images: shot.parts,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(products.length ? { productIds: products.map((p) => p.productId) } : {}),
      });
      setParams({ id: r.id });
      setShot(null);
      setNotes("");
      setProducts([]);
    } catch (e) {
      toast.error(errorMessage(e, "The page couldn't be started"));
    } finally {
      setBusy(false);
    }
  };

  const left = mine ? Math.max(0, mine.limit - mine.used) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6" onPaste={(e) => void pick(pastedImage(e))}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-primary" /> Screenshot to page
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a screenshot of a landing or product page you like, or paste its link. The AI builds it as one HTML page with Tailwind that you can preview, change in your own words and
          download, or publish it to your Shopify store as its own page. Photos are matching free stock photos from Pexels: swap in your own product photos.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        {shot ? (
          <div className="flex gap-3 items-start">
            <img src={shot.preview} alt="Your screenshot" className="w-28 h-28 rounded-md object-cover object-top border border-border shrink-0" />
            <div className="text-sm space-y-1 min-w-0">
              <p className="font-medium">Screenshot ready</p>
              <p className="text-xs text-muted-foreground">
                {shot.parts.length > 1 ? `A long page: it goes to the AI in ${shot.parts.length} parts, top to bottom.` : "One part."}
              </p>
              <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => setShot(null)}>
                <X className="w-4 h-4 mr-1" /> Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "w-full rounded-lg border border-dashed px-4 py-8 text-sm transition flex flex-col items-center gap-2",
              dragging ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-primary",
            )}
          >
            <ImageUp className="w-6 h-6" />
            Drop, paste (Ctrl+V) or choose a screenshot · a full-page screenshot works best
          </button>
        )}
        {!shot ? <LinkScreenshot onShot={pick} /> : null}
        <PageProducts value={products} onChange={setProducts} />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Notes for the AI, optional: e.g. write it in Danish, use my brand name Rank Ryg, leave out the reviews section"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void make()} disabled={!shot || busy || left === 0}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
            Build the page
          </Button>
          {left !== null ? <span className="text-xs text-muted-foreground">{left} pages or changes left today</span> : null}
        </div>
        {mine && mine.pages.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {mine.pages.map((p) => (
              <button
                key={p._id}
                type="button"
                onClick={() => setParams({ id: p._id })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 min-h-10 sm:min-h-0 text-xs transition max-w-56 truncate",
                  id === p._id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {p.status === "making" ? "Building… " : p.status === "failed" ? "Failed · " : ""}
                {p.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {page ? <Result page={page} onRemoved={() => setParams({})} /> : null}
    </div>
  );
}

function Result({ page, onRemoved }: { page: PageView; onRemoved: () => void }) {
  const edit = useAction(api.screenPagesAi.edit);
  const undo = useMutation(api.screenPages.undo);
  const remove = useMutation(api.screenPages.remove);
  const [tab, setTab] = useState<"preview" | "code" | "screenshot">("preview");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [change, setChange] = useState("");
  const [sending, setSending] = useState(false);
  const publishPage = useAction(api.screenPagesShopify.publish);
  const [publishing, setPublishing] = useState(false);
  const [publishProblem, setPublishProblem] = useState<{ message: string; code?: string; files?: Record<string, string> } | null>(null);
  const restoreHome = useAction(api.screenPagesShopify.restoreHome);
  const [asHomeInput, setAsHome] = useState<boolean | null>(null);
  const asHome = asHomeInput ?? !!page.shopify?.home;
  const [restoring, setRestoring] = useState(false);

  const making = page.status === "making";
  const html = page.html ?? "";

  const download = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "page"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const send = async () => {
    if (!change.trim()) return;
    setSending(true);
    try {
      await edit({ id: page._id, change: change.trim() });
      setChange("");
    } catch (e) {
      toast.error(errorMessage(e, "The change couldn't be started"));
    } finally {
      setSending(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setPublishProblem(null);
    try {
      const r = await publishPage({ id: page._id, ...(asHome ? { asHome: true } : {}) });
      const linked = r.linked ? ` ${r.linked} links now go to your store's pages.` : "";
      if (r.note) toast.warning(r.note);
      else toast.success(`${r.home ? "It's your store's home page now." : r.updated ? "Updated in your Shopify store." : "Published in your Shopify store."}${linked}`);
    } catch (e) {
      const data = e instanceof ConvexError ? (e.data as { code?: string; message?: string; files?: Record<string, string> }) : null;
      setPublishProblem({ message: errorMessage(e, "The page couldn't be published"), code: data?.code, files: data?.files });
    } finally {
      setPublishing(false);
    }
  };
  const restore = async () => {
    setRestoring(true);
    try {
      await restoreHome({ id: page._id });
      setAsHome(false);
      toast.success("Your store's earlier home page is back.");
    } catch (e) {
      toast.error(errorMessage(e, "The home page couldn't be restored"));
    } finally {
      setRestoring(false);
    }
  };
  // Changed since it went to Shopify (made, changed or undone later).
  const outdated = !!page.shopify && page.updatedAt > page.shopify.publishedAt;

  const tabButton = (value: typeof tab, label: string, Icon: typeof Eye) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition", tab === value ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground")}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold truncate">{page.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          {html ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(html).then(() => toast.success("HTML copied"))}>
                <Copy className="w-4 h-4 mr-1.5" /> Copy code
              </Button>
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="w-4 h-4 mr-1.5" /> Download
              </Button>
            </>
          ) : null}
          {html && !making ? (
            <Button size="sm" onClick={() => void publish()} disabled={publishing} variant={page.shopify && !outdated ? "outline" : "default"}>
              {publishing ? <Spinner className="w-4 h-4 mr-1.5" /> : <ShoppingBag className="w-4 h-4 mr-1.5" />}
              {page.shopify ? (outdated ? "Update in Shopify" : "Publish again") : "Publish to Shopify"}
            </Button>
          ) : null}
          {page.canUndo && !making ? (
            <Button size="sm" variant="outline" onClick={() => void undo({ id: page._id })}>
              <Undo2 className="w-4 h-4 mr-1.5" /> Undo change
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => void remove({ id: page._id }).then(onRemoved, (e: unknown) => toast.error(errorMessage(e, "Couldn't delete the page")))}
          >
            <Trash2 className="w-4 h-4 mr-1.5" /> Delete
          </Button>
        </div>
      </div>

      {making ? (
        <p className="flex items-center gap-2 text-sm rounded-lg bg-muted/50 px-3 py-2">
          <Spinner className="w-4 h-4" />
          {page.pending ? `Changing: “${page.pending}”…` : "Building your page…"} This usually takes 1–3 minutes. You can leave this page.
        </p>
      ) : null}
      {page.error ? <p className={cn("text-sm", page.status === "failed" ? "text-destructive" : "text-warn")}>{page.status === "failed" ? page.error : `The last change didn't work: ${page.error}`}</p> : null}
      {html && !making ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={asHome} onChange={(e) => setAsHome(e.target.checked)} />
          <span>
            Make it my store's home page
            <span className="block text-xs text-muted-foreground">
              Your theme's current home page is saved in AdSpy first, so you can bring it back. The menu bar and buttons are linked to your store's pages when you publish.
            </span>
          </span>
        </label>
      ) : null}
      {page.shopify ? (
        <p className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{page.shopify.home ? "Your home page:" : outdated ? "In your store (older version):" : "In your store:"}</span>
          <a href={page.shopify.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
            {page.shopify.url.replace(/^https?:\/\//, "")} <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a href={page.shopify.adminUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground hover:underline">Edit in Shopify</a>
          {page.shopify.home ? (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void restore()} disabled={restoring}>
              {restoring ? <Spinner className="w-4 h-4 mr-1.5" /> : <Undo2 className="w-4 h-4 mr-1.5" />} Restore my old home page
            </Button>
          ) : null}
        </p>
      ) : null}
      {publishProblem ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
          <p className="text-destructive">{publishProblem.message}</p>
          {publishProblem.code === "NO_STORE" || publishProblem.code === "RECONNECT" ? (
            <Link to="/dashboard/settings" className="text-primary hover:underline">Go to Settings → Shopify</Link>
          ) : null}
          {publishProblem.files
            ? Object.entries(publishProblem.files).map(([name, content]) => (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-semibold">{name}</code>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => void navigator.clipboard.writeText(content).then(() => toast.success(`${name} copied`))}>
                      <Copy className="w-4 h-4 mr-1.5" /> Copy
                    </Button>
                  </div>
                  <pre className="rounded-md bg-background border border-border p-2 text-xs whitespace-pre-wrap max-h-40 overflow-auto">{content}</pre>
                </div>
              ))
            : null}
        </div>
      ) : null}
      {page.products.length ? (
        <p className="text-xs text-muted-foreground">
          Products: {page.products.map((p, i) => (
            <span key={p.url}>
              {i ? ", " : ""}
              <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{p.title}</a>
            </span>
          ))}
        </p>
      ) : null}
      {page.lastChange && !making ? <p className="text-xs text-muted-foreground">Last change: “{page.lastChange}”</p> : null}
      {page.photoCredits?.length ? (
        <p className="text-xs text-muted-foreground">
          Photos by{" "}
          {page.photoCredits.map((c, i) => (
            <span key={c.photographerUrl}>
              {i ? ", " : ""}
              <a href={c.photographerUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{c.photographer}</a>
            </span>
          ))}{" "}
          on{" "}
          <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Pexels</a>
          , free to use.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex gap-1">
          {tabButton("preview", "Preview", Eye)}
          {tabButton("code", "Code", Code2)}
          {tabButton("screenshot", "Screenshot", ImageIcon)}
        </div>
        {tab === "preview" ? (
          <div className="flex gap-1">
            <Button size="sm" variant={device === "desktop" ? "secondary" : "ghost"} onClick={() => setDevice("desktop")} aria-label="Desktop">
              <Monitor className="w-4 h-4" />
            </Button>
            <Button size="sm" variant={device === "phone" ? "secondary" : "ghost"} onClick={() => setDevice("phone")} aria-label="Phone">
              <Smartphone className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {tab === "preview" ? (
        html ? (
          <div className="rounded-lg border border-border bg-muted/30 overflow-hidden flex justify-center">
            {/* The AI's page runs sandboxed: its scripts get no access to the app. */}
            <iframe
              title="Page preview"
              sandbox="allow-scripts"
              srcDoc={html}
              className={cn("bg-white h-[75vh] transition-all", device === "phone" ? "w-[390px] max-w-full border-x border-border" : "w-full")}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-10 text-center">{making ? "The preview shows up here when the page is ready." : "No page yet."}</p>
        )
      ) : tab === "code" ? (
        <pre className="rounded-lg border border-border bg-muted/40 p-3 text-xs overflow-auto max-h-[75vh] whitespace-pre-wrap break-all">{html || "No code yet."}</pre>
      ) : (
        <div className="rounded-lg border border-border overflow-auto max-h-[75vh]">
          {page.imageUrls.map((u) => (
            <img key={u} src={u} alt="Your screenshot" className="w-full block" />
          ))}
        </div>
      )}

      {html ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={change}
            onChange={(e) => setChange(e.target.value)}
            maxLength={1000}
            disabled={making}
            placeholder="Change something: e.g. make the buttons green, add a FAQ section, translate it to Swedish"
            className="flex-1 min-w-60"
          />
          <Button type="submit" disabled={making || sending || !change.trim()}>
            {sending ? <Spinner className="w-4 h-4 mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
            Change it
          </Button>
        </form>
      ) : null}
    </div>
  );
}
