import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Code2, Copy, Download, Eye, ImageIcon, ImageUp, Monitor, Smartphone, Trash2, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
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
      const r = await create({ images: shot.parts, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      setParams({ id: r.id });
      setShot(null);
      setNotes("");
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
          Upload a screenshot of a landing or product page you like. The AI builds it as one HTML page with Tailwind that you can preview, change in your own words and
          download. Photos become placeholders: put in your own.
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
      {page.lastChange && !making ? <p className="text-xs text-muted-foreground">Last change: “{page.lastChange}”</p> : null}

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
