import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Copy, Languages, Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { TRANSCRIPT_LANGUAGES } from "@/convex/lib/transcriptLanguages.ts";

// "What's said" on the ad page and pop-up: the video's spoken first line (hook)
// and its transcript (convex/transcripts.ts, Deepgram), with an AI translation.
// Video ads without one get a "Transcribe video" button (transcripts.transcribe).
export default function AdTranscript({ ad, compact = false }: { ad: Doc<"ads">; compact?: boolean }) {
  const translate = useAction(api.transcriptsAi.translate);
  const transcribe = useAction(api.transcripts.transcribe);
  const [language, setLanguage] = useState<string>("original");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Record<string, string>>({});
  // Keyed by ad, so a pop-up reused for another ad starts fresh.
  const [heard, setHeard] = useState<{ adId: string; transcript: string | null; hook: string | null } | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const fresh = heard?.adId === ad._id ? heard : null;
  const transcript = ad.transcript ?? fresh?.transcript ?? undefined;
  const hook = ad.spokenHook ?? fresh?.hook ?? undefined;
  const box = compact ? "bg-card border border-border rounded-xl p-3.5" : "bg-card border border-border rounded-xl p-5";

  if (!transcript) {
    // Only video files can be transcribed (TikTok embeds have none).
    if (!ad.videoUrl && !ad.hostedVideoUrl) return null;
    const noSpeech = !!fresh || !!ad.transcriptCheckedAt;
    const run = async () => {
      setTranscribing(true);
      try {
        const r = await transcribe({ adId: ad._id });
        setHeard({ adId: ad._id, transcript: r.transcript, hook: r.hook });
        if (!r.transcript) toast.info("No speech found in this video.");
      } catch (e) {
        toast.error(e instanceof ConvexError ? ((e.data as { message?: string }).message ?? "Couldn't transcribe it.") : "Couldn't transcribe it.");
      } finally {
        setTranscribing(false);
      }
    };
    return (
      <div className={cn(box, "flex flex-wrap items-center gap-3")}>
        <Mic className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">What's said in the video</h2>
          <p className="text-xs text-muted-foreground">
            {noSpeech ? "We found no speech in this video." : "Get the voice-over as text, with the hook from the first 3 seconds."}
          </p>
        </div>
        {!noSpeech && (
          <Button variant="outline" size="sm" onClick={run} disabled={transcribing}>
            {transcribing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mic className="w-3.5 h-3.5 mr-1.5" />}
            {transcribing ? "Transcribing…" : "Transcribe video"}
          </Button>
        )}
      </div>
    );
  }

  const translations = { ...(ad.transcriptTranslations ?? {}), ...made };
  const shown = language === "original" ? transcript : translations[language];

  const pick = async (next: string) => {
    setLanguage(next);
    if (next === "original" || translations[next]) return;
    setBusy(true);
    try {
      const { text } = await translate({ adId: ad._id, language: next });
      setMade((m) => ({ ...m, [next]: text }));
    } catch (e) {
      toast.error(e instanceof ConvexError ? (e.data as { message?: string }).message ?? "Couldn't translate it." : "Couldn't translate it.");
      setLanguage("original");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      toast.success("Transcript copied");
    } catch {
      toast.error("Couldn't copy it");
    }
  };

  return (
    <div className={box}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Mic className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm flex-1">What's said in the video</h2>
        {!compact && (
        <FilterSelect
          label="Language"
          value={language}
          onChange={pick}
          options={[{ value: "original", label: "As spoken" }, ...TRANSCRIPT_LANGUAGES.map((l) => ({ value: l, label: translations[l] ? `${l} ✓` : l }))]}
          active={language !== "original"}
        />
        )}
        <Button variant="outline" size="sm" onClick={copy} disabled={!shown}>
          <Copy className="w-3.5 h-3.5 mr-1.5" />Copy
        </Button>
      </div>
      {hook && (
        <p className="text-sm mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-2">Hook, first 3 s</span>
          “{hook}”
        </p>
      )}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <Languages className="w-4 h-4" />Translating into {language}…
        </p>
      ) : (
        <p className={cn("text-sm text-muted-foreground whitespace-pre-line leading-relaxed overflow-y-auto", compact ? "max-h-40" : "max-h-72")}>{shown}</p>
      )}
    </div>
  );
}
