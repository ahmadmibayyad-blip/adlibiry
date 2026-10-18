import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { Copy, Languages, Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import { TRANSCRIPT_LANGUAGES } from "@/convex/lib/transcriptLanguages.ts";

// "What's said" on the ad page: the video's spoken first line (hook) and its
// transcript (convex/transcripts.ts, Deepgram), with an AI translation.
export default function AdTranscript({ ad }: { ad: Doc<"ads"> }) {
  const translate = useAction(api.transcriptsAi.translate);
  const [language, setLanguage] = useState<string>("original");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Record<string, string>>({});
  if (!ad.transcript) return null;

  const translations = { ...(ad.transcriptTranslations ?? {}), ...made };
  const shown = language === "original" ? ad.transcript : translations[language];

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
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Mic className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm flex-1">What's said in the video</h2>
        <FilterSelect
          label="Language"
          value={language}
          onChange={pick}
          options={[{ value: "original", label: "As spoken" }, ...TRANSCRIPT_LANGUAGES.map((l) => ({ value: l, label: translations[l] ? `${l} ✓` : l }))]}
          active={language !== "original"}
        />
        <Button variant="outline" size="sm" onClick={copy} disabled={!shown}>
          <Copy className="w-3.5 h-3.5 mr-1.5" />Copy
        </Button>
      </div>
      {ad.spokenHook && (
        <p className="text-sm mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-2">Hook, first 3 s</span>
          “{ad.spokenHook}”
        </p>
      )}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <Languages className="w-4 h-4" />Translating into {language}…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed max-h-72 overflow-y-auto">{shown}</p>
      )}
    </div>
  );
}
