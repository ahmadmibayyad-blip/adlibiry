import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Download, ImagePlus, Loader2, RotateCcw, Shuffle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import RemakeTopUpDialog from "@/components/billing/RemakeTopUpDialog.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// AI Studio → Playground: describe a clip, optionally start from a product photo, pick a fal model, format and length,
// generate (convex/studio.ts). Each finished take stays below with Re-roll, Other model and Download.

const MAX_PROMPT = 1500;
const TIPS = [
  "Say who or what is in the shot and what happens.",
  "Add a camera move: slow push in, handheld, orbit.",
  "Set the light and mood: morning sun, studio, cosy.",
];
const euros = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
const secondsFor = (multiplier: number, length: number) => Math.max(1, Math.ceil(length * multiplier));

/** "5 or 10 s", "3, 5, 8, 10 or 12 s". */
const lengthsText = (lengths: number[]) =>
  lengths.length > 1 ? `${lengths.slice(0, -1).join(", ")} or ${lengths[lengths.length - 1]} s` : `${lengths[0]} s`;

type Take = { id: string; videoUrl: string; model: string; prompt: string; aspect: string; length: number; imageId: string | null };

/** "Kling 3 Pro · 9:16 · 5 s"; a clip made from a photo by a model that follows it says so instead of a format. */
function takeLabel(t: Take, m: { name: string; photoAspect: boolean } | undefined): string {
  const format = t.imageId && m && !m.photoAspect ? "follows the photo" : t.aspect;
  return `${m?.name ?? t.model} · ${format} · ${t.length} s`;
}

function Choice({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn("h-8 px-3 rounded-md border text-sm", value === o ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function Playground() {
  const models = useQuery(api.studio.models, {});
  const latest = useQuery(api.studio.latest, {});
  const allowance = useQuery(api.remake.allowance, {});
  const start = useMutation(api.studio.start);
  const uploadUrl = useMutation(api.remake.uploadUrl);
  const claimUpload = useMutation(api.remake.claimUpload);
  const [prompt, setPrompt] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [length, setLength] = useState(0);
  const [photo, setPhoto] = useState<{ storageId: Id<"_storage">; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState(false);
  const [takes, setTakes] = useState<Take[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Models that need a photo show up once one is added.
  const shown = models?.filter((m) => !m.needsPhoto || photo);
  const model = shown?.find((m) => m.key === modelKey) ?? shown?.[0];
  const followsPhoto = !!photo && !!model && !model.photoAspect;
  const lengths = model?.lengths ?? [];
  const len = lengths.includes(length) ? length : (lengths[0] ?? 0);
  const asp = model && !followsPhoto && !(model.aspects as string[]).includes(aspect) ? model.aspects[0] : aspect;

  // Keep each finished clip as a take, once (state adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState<string | null>(null);
  if (latest?.status === "done" && latest.videoUrl && latest._id !== seen) {
    const take: Take = { id: latest._id, videoUrl: latest.videoUrl, model: latest.model, prompt: latest.prompt, aspect: latest.aspect, length: latest.length, imageId: latest.imageId };
    setSeen(latest._id);
    setTakes((list) => (list.some((t) => t.id === take.id) ? list : [take, ...list]));
  }

  if (!models || !allowance) return null;

  const canMake = allowance.limit === null || allowance.limit > 0 || allowance.extra > 0;
  if (!canMake) {
    return (
      <p className="text-sm">
        AI videos come with Pro.{" "}
        <a href="/pricing" className="text-primary underline underline-offset-2">
          Upgrade
        </a>
      </p>
    );
  }

  const running = latest?.status === "rendering";
  const needsPhoto = !!model?.needsPhoto && !photo;
  const left = allowance.limit === null ? null : Math.max(0, allowance.limit - allowance.used);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await fetch(await uploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await claimUpload({ storageId });
      setPhoto({ storageId, name: file.name });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't upload the photo."));
    } finally {
      setUploading(false);
      e.target.value = ""; // so the same file can be picked again
    }
  };

  const run = async (args: { model: string; prompt: string; aspect: string; length: number; imageId?: Id<"_storage"> }) => {
    setBusy(true);
    try {
      await start(args);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start the clip."));
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    if (!model) return;
    void run({ model: model.key, prompt: prompt.trim(), aspect: asp, length: len, ...(photo ? { imageId: photo.storageId } : {}) });
  };

  const reroll = (t: Take) =>
    void run({ model: t.model, prompt: t.prompt, aspect: t.aspect, length: t.length, ...(t.imageId ? { imageId: t.imageId as Id<"_storage"> } : {}) });

  const otherModel = (t: Take) => {
    setPrompt(t.prompt);
    setAspect(t.aspect);
    setLength(t.length);
    setPhoto(t.imageId ? { storageId: t.imageId as Id<"_storage">, name: "Photo from this take" } : null);
    pickerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    pickerRef.current?.focus();
  };

  return (
    <div className="space-y-5">
      <section>
        <label htmlFor="studio-prompt" className="font-semibold text-sm">
          Describe your video
        </label>
        <Textarea
          id="studio-prompt"
          value={prompt}
          maxLength={MAX_PROMPT}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A golden retriever stretches out on a blue cooling mat on a sunny patio, slow push in, warm afternoon light."
          className="mt-1.5 min-h-24"
        />
        <ul className="mt-1.5 text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-md border border-border text-sm cursor-pointer hover:bg-muted">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            <span>{photo ? photo.name : "Product photo (optional)"}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Product photo" onChange={upload} />
          </label>
          {photo && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setPhoto(null)} aria-label="Remove photo">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
          <span className="text-xs text-muted-foreground">The photo becomes the first frame.</span>
        </div>
      </section>

      <section>
        <h3 className="font-semibold text-sm mb-1.5">Model</h3>
        <div ref={pickerRef} tabIndex={-1} role="radiogroup" aria-label="Model" className="grid grid-cols-1 sm:grid-cols-2 gap-2 outline-none">
          {(shown ?? []).map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={model?.key === m.key}
              onClick={() => setModelKey(m.key)}
              className={cn(
                "text-left rounded-lg border-2 p-3 transition-colors",
                model?.key === m.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              <span className="block font-medium text-sm">{m.name}</span>
              <span className="block text-xs text-muted-foreground">{m.blurb}</span>
              <span className="block text-xs mt-1">
                {lengthsText(m.lengths)} · Uses {secondsFor(m.multiplier, m.lengths.includes(len) ? len : m.lengths[0])} s
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        {followsPhoto ? (
          <p className="text-xs text-muted-foreground">Format: follows the photo.</p>
        ) : (
          model &&
          (model.aspects.length > 1 ? (
            <Choice label="Format" options={model.aspects} value={asp} onChange={setAspect} />
          ) : (
            <p className="text-xs text-muted-foreground">Format: {model.aspects[0]}</p>
          ))
        )}
        <Choice label="Length" options={lengths.map((l) => `${l} s`)} value={`${len} s`} onChange={(v) => setLength(Number.parseInt(v, 10))} />
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>
            {left === null ? "Unlimited AI video" : `${left} s of AI video left this month`}
            {allowance.extra > 0 && ` + ${allowance.extra} s bought`}
          </span>
          {allowance.canBuy && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setBuying(true)}>
              Buy {allowance.pack.seconds} s for €{euros(allowance.pack.cents)}
            </Button>
          )}
        </div>
        {needsPhoto && <p className="text-sm text-muted-foreground mb-2">Add a product photo for this model.</p>}
        {running ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Making your clip… (1–4 min)
          </div>
        ) : (
          <Button onClick={generate} disabled={!prompt.trim() || needsPhoto || busy || uploading || !model}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            Generate
          </Button>
        )}
        {latest?.status === "failed" && latest.error && <p className="text-sm text-destructive mt-2">{latest.error}</p>}
      </section>

      {takes.length > 0 && (
        <section>
          <h3 className="font-semibold text-sm mb-2">Takes</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {takes.map((t) => (
              <div key={t.id} className="shrink-0 w-[220px]">
                <video controls src={t.videoUrl} className="w-full rounded-lg bg-black max-h-[360px]" />
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {takeLabel(t, models.find((m) => m.key === t.model))}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Button variant="outline" size="sm" className="h-8" onClick={() => reroll(t)} disabled={busy || running}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Re-roll
                  </Button>
                  <Button variant="outline" size="sm" className="h-8" onClick={() => otherModel(t)}>
                    <Shuffle className="w-3.5 h-3.5 mr-1" />
                    Other model
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8">
                    <a href={t.videoUrl} download="ai-clip.mp4">
                      <Download className="w-3.5 h-3.5 mr-1" />
                      Download MP4
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Made with AI. Mark it as AI-generated when you run it as an ad.</p>
        </section>
      )}
      <RemakeTopUpDialog open={buying} onOpenChange={setBuying} />
    </div>
  );
}
