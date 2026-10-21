import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronDown, Clapperboard, Copy, Download, Loader2, Mic, RotateCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { TRANSCRIPT_LANGUAGES } from "@/convex/lib/transcriptLanguages.ts";
import { variantText, type Analysis, type Variant } from "@/convex/lib/videoAnalysis.ts";
import { voiceText, type VoiceOption } from "@/convex/lib/voiceover.ts";
import { Button } from "@/components/ui/button.tsx";
import StepNumber from "@/components/StepNumber.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import RemakeVideo from "./RemakeVideo.tsx";

// Ad page → "Why this video works": the AI breakdown of a video ad (convex/videoAnalysis.ts,
// Apify) and "Write my version", a new script with a shot timeline for the user's product
// (videoAnalysisAi.writeVariant), then "Make the video" (RemakeVideo.tsx, AI actor + product shots).

const secs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const BOX = "bg-card border border-border rounded-xl p-5";

export default function AdVideoAnalysis({ ad }: { ad: Doc<"ads"> }) {
  const state = useQuery(api.videoAnalysis.forAd, { adId: ad._id });
  const start = useMutation(api.videoAnalysis.start);
  const [starting, setStarting] = useState(false);
  if (!ad.videoUrl && !ad.hostedVideoUrl) return null;
  if (state === undefined) return null;

  const run = async () => {
    setStarting(true);
    try {
      await start({ adId: ad._id });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't start the analysis."));
    } finally {
      setStarting(false);
    }
  };

  if (state?.status === "done" && state.result) return <AnalysisView adId={ad._id} a={state.result} />;

  const running = state?.status === "running";
  return (
    <div className={cn(BOX, "flex flex-wrap items-center gap-3")}>
      <Clapperboard className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-sm">
          <StepNumber n={1} />
          Why this video works
        </h2>
        <p className="text-xs text-muted-foreground">
          {running
            ? "Watching the video… this takes about a minute. You can leave the page; it keeps going."
            : state?.status === "failed"
              ? state.error
              : "AI watches the video: its hook, angle, beats and every shot, then writes your own version for your product."}
        </p>
      </div>
      <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={run} disabled={running || starting}>
        {running || starting ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : state?.status === "failed" ? (
          <RotateCw className="w-3.5 h-3.5 mr-1.5" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
        )}
        {running ? "Analysing…" : starting ? "Starting…" : state?.status === "failed" ? "Try again" : "Analyse video"}
      </Button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>
      <ul className="text-sm list-disc pl-5 space-y-0.5">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

function AnalysisView({ adId, a }: { adId: Doc<"ads">["_id"]; a: Analysis }) {
  const [showShots, setShowShots] = useState(false);
  const total = a.durationSeconds ?? Math.max(1, ...a.structure.map((b) => b.end));
  return (
    <div className={cn(BOX, "space-y-5")}>
      <div className="flex items-center gap-2">
        <Clapperboard className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm flex-1">
          <StepNumber n={1} />
          Why this video works
        </h2>
        {a.durationSeconds !== null && (
          <span className="text-xs text-muted-foreground">
            {a.durationSeconds} s{a.pacing ? `, ${a.pacing.cuts} cuts${a.pacing.avgShotSeconds ? ` (a cut every ${a.pacing.avgShotSeconds} s)` : ""}` : ""}
          </span>
        )}
      </div>

      {a.hook && (
        <div>
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-2">Hook{a.hook.type ? `, ${a.hook.type}` : ""}</span>
            “{a.hook.text}”
          </p>
          {a.hook.why && <p className="text-xs text-muted-foreground mt-1">{a.hook.why}</p>}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Angle" value={a.angle} />
        <Fact label="Offer" value={a.offer} />
        <Fact label="Tone" value={a.tone} />
        <Fact label="Call to action" value={a.cta ? `${a.cta.text}${a.cta.time !== null ? ` (at ${secs(a.cta.time)})` : ""}` : ""} />
      </div>

      {a.whyItWorks && <p className="text-sm text-muted-foreground leading-relaxed">{a.whyItWorks}</p>}

      {a.structure.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Structure</div>
          <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-2" aria-hidden>
            {a.structure.map((b, i) => (
              <div
                key={i}
                className={cn("h-full", i % 2 ? "bg-primary/50" : "bg-primary")}
                style={{ width: `${Math.max(2, ((b.end - b.start) / total) * 100)}%` }}
              />
            ))}
          </div>
          <ol className="space-y-1">
            {a.structure.map((b, i) => (
              <li key={i} className="text-sm flex gap-3">
                <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground pt-0.5">{secs(b.start)}–{secs(b.end)}</span>
                <span>
                  <span className="font-medium capitalize">{b.beat.replace(/_/g, " ")}</span>
                  {b.description && <span className="text-muted-foreground">: {b.description}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {a.shots.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowShots((s) => !s)}
            aria-expanded={showShots}
            className="flex min-h-10 sm:min-h-0 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showShots && "rotate-180")} />
            Shot list ({a.shots.length} shots)
          </button>
          {showShots && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Time</th>
                    <th className="py-1 pr-3 font-medium">Shot</th>
                    <th className="py-1 pr-3 font-medium">On screen</th>
                    <th className="py-1 font-medium">Said</th>
                  </tr>
                </thead>
                <tbody>
                  {a.shots.map((s, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{secs(s.start)}</td>
                      <td className="py-1.5 pr-3">{[s.shot, s.scene, s.action].filter(Boolean).join(" · ")}</td>
                      <td className="py-1.5 pr-3">{s.onScreenText}</td>
                      <td className="py-1.5">{s.spoken}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <List title="Pain points" items={a.painPoints} />
        <List title="Benefits shown" items={a.benefits} />
        <List title="Proof" items={a.socialProof} />
        <List title="Ideas to test" items={a.suggestions} />
      </div>

      <WriteVariant adId={adId} />
    </div>
  );
}

function WriteVariant({ adId }: { adId: Doc<"ads">["_id"] }) {
  const write = useAction(api.videoAnalysisAi.writeVariant);
  const [product, setProduct] = useState("");
  const [angle, setAngle] = useState("");
  const [language, setLanguage] = useState<string>("English");
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<Variant | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (product.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      setVariant(await write({ adId, product, angle: angle || undefined, language }));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't write the script."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!variant) return;
    try {
      await navigator.clipboard.writeText(variantText(variant));
      toast.success("Script copied");
    } catch {
      toast.error("Couldn't copy it");
    }
  };

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-center gap-2 mb-1">
        <Wand2 className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">
          <StepNumber n={2} />
          Write my version
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        A new script and shot timeline for your product, built on this ad's structure. New words, not a copy.
      </p>
      <form onSubmit={submit} className="space-y-2">
        <Textarea
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="Your product: what it is, who it's for, what it does better. Add your offer if you have one."
          maxLength={1500}
          rows={3}
          aria-label="Your product"
        />
        <div className="flex flex-wrap gap-2">
          <Input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Angle (optional), e.g. gift for dog owners" maxLength={300} className="flex-1 min-w-48" aria-label="Angle" />
          <FilterSelect label="Language" value={language} onChange={setLanguage} options={TRANSCRIPT_LANGUAGES.map((l) => ({ value: l, label: l }))} />
          <Button type="submit" disabled={product.trim().length < 3 || busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
            {busy ? "Writing…" : variant ? "Write another" : "Write script"}
          </Button>
        </div>
      </form>

      {variant && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <div className="flex items-start gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{variant.title}</div>
              {variant.hook && <div className="text-sm text-muted-foreground">Hook: “{variant.hook}”</div>}
            </div>
            <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={copy}>
              <Copy className="w-3.5 h-3.5 mr-1.5" />Copy
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-3 font-medium">Time</th>
                  <th className="py-1 pr-3 font-medium">Film this</th>
                  <th className="py-1 pr-3 font-medium">On screen</th>
                  <th className="py-1 font-medium">Voice-over</th>
                </tr>
              </thead>
              <tbody>
                {variant.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{secs(l.start)}–{secs(l.end)}</td>
                    <td className="py-1.5 pr-3">{l.scene}</td>
                    <td className="py-1.5 pr-3">{l.onScreenText}</td>
                    <td className="py-1.5">{l.voiceover}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {variant.cta && <p className="text-sm mt-3"><span className="font-medium">Call to action:</span> {variant.cta}</p>}
          {variant.notes && <p className="text-xs text-muted-foreground mt-1">{variant.notes}</p>}
          <Voiceover text={voiceText(variant.lines)} />
          <RemakeVideo adId={adId} variant={variant} product={product} />
        </div>
      )}
    </div>
  );
}

// The script's voice-over lines read out by an AI voice (convex/voiceover.ts, ElevenLabs), as an MP3 to play or download.
function Voiceover({ text }: { text: string }) {
  const loadVoices = useAction(api.voiceover.voices);
  const make = useAction(api.voiceover.make);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<{ url: string; text: string } | null>(null);
  if (!text) return null;

  const open = async () => {
    setBusy(true);
    try {
      const list = await loadVoices({});
      setVoices(list);
      setVoiceId(list[0]?.id ?? "");
      if (!list.length) toast.error("No voices available.");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't load the voices."));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!voiceId || busy) return;
    setBusy(true);
    try {
      const r = await make({ text, voiceId });
      setAudio({ url: r.url, text });
    } catch (e) {
      toast.error(errorMessage(e, "The voiceover failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border">
      {voices === null ? (
        <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={open} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mic className="w-3.5 h-3.5 mr-1.5" />}
          Make a voiceover
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Voice"
            value={voiceId}
            onChange={setVoiceId}
            options={voices.map((v) => ({ value: v.id, label: [v.name, v.gender, v.accent].filter(Boolean).join(" · ") }))}
          />
          <Button size="sm" className="h-10 sm:h-8" onClick={run} disabled={!voiceId || busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mic className="w-3.5 h-3.5 mr-1.5" />}
            {busy ? "Recording…" : audio?.text === text ? "Record again" : "Record voiceover"}
          </Button>
        </div>
      )}
      {audio && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <audio controls src={audio.url} className="h-9 max-w-full" />
          <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
            <a href={audio.url} download="voiceover.mp3">
              <Download className="w-3.5 h-3.5 mr-1.5" />MP3
            </a>
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-1.5">Reads the voice-over lines in the script's language. AI voice by ElevenLabs.</p>
    </div>
  );
}
