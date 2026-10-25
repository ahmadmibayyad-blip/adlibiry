import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { Clapperboard, Download, ImagePlus, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { REMAKE_ACTORS } from "@/convex/lib/remake.ts";
import type { Variant } from "@/convex/lib/videoAnalysis.ts";
import type { VoiceOption } from "@/convex/lib/voiceover.ts";
import { Button } from "@/components/ui/button.tsx";
import StepNumber from "@/components/StepNumber.tsx";
import FilterSelect from "@/components/FilterSelect.tsx";
import RemakeTopUpDialog from "@/components/billing/RemakeTopUpDialog.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Under a "Write my version" script: "Make the video" turns it into a 9:16 ad with an AI actor
// and AI product shots (convex/remake.ts). Shows the user's AI-video seconds and sells more.

const PROGRESS: Record<string, string> = {
  voicing: "Recording the voice…",
  rendering: "Making the actor and product shots… (2–5 min)",
  composing: "Putting the video together…",
};

const euros = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export default function RemakeVideo({ adId, variant, product }: { adId: Id<"ads">; variant: Variant; product: string }) {
  const allowance = useQuery(api.remake.allowance, {});
  const latest = useQuery(api.remake.latestForAd, { adId });
  const start = useMutation(api.remake.start);
  const redo = useMutation(api.remake.redo);
  const uploadUrl = useMutation(api.remake.uploadUrl);
  const claimUpload = useMutation(api.remake.claimUpload);
  const loadVoices = useAction(api.voiceover.voices);
  const [actorId, setActorId] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [photo, setPhoto] = useState<{ storageId: Id<"_storage">; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  const canMake = !!allowance && (allowance.limit === null || allowance.limit > 0 || allowance.extra > 0);

  useEffect(() => {
    if (!canMake) return;
    let cancelled = false;
    loadVoices({})
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        setVoiceId((v) => v || list[0]?.id || "");
      })
      .catch(() => !cancelled && toast.error("Couldn't load the voices."));
    return () => {
      cancelled = true;
    };
  }, [canMake, loadVoices]);

  if (!allowance) return null;

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

  const make = async () => {
    if (!actorId || !photo || !voiceId || busy) return;
    setBusy(true);
    try {
      await start({ adId, variant, actorId, voiceId, product, productImageId: photo.storageId });
      setDismissed(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start the video."));
    } finally {
      setBusy(false);
    }
  };

  // Free "Make it again": the actor and voice picked below if any, else the video's own.
  const makeAgain = async () => {
    if (!latest?.redoId || busy) return;
    setBusy(true);
    try {
      await redo({ remakeId: latest.redoId, actorId: actorId || undefined, voiceId: voiceId || undefined });
      setDismissed(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start the video."));
    } finally {
      setBusy(false);
    }
  };
  const againButton = latest?.redoId && (
    <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={makeAgain} disabled={busy}>
      {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
      Make it again free
    </Button>
  );

  const active = latest && PROGRESS[latest.status];
  const left = allowance.limit === null ? null : Math.max(0, allowance.limit - allowance.used);

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-1">
        <Clapperboard className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">
          <StepNumber n={3} />
          Make the video
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">An AI actor says this script, with AI shots of your product cut in. Vertical 9:16 video.</p>

      {!canMake ? (
        <p className="text-sm">
          AI videos come with Pro.{" "}
          <Link to="/pricing" className="text-primary underline underline-offset-2">
            Upgrade
          </Link>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
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

          {latest?.status === "done" && latest.videoUrl && (
            <div className="mb-4">
              <video controls src={latest.videoUrl} className="w-full max-w-[280px] aspect-[9/16] rounded-lg bg-black" />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                  <a href={latest.videoUrl} download="ai-ad.mp4">
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download MP4
                  </a>
                </Button>
                {againButton}
              </div>
              {latest.redoId && (
                <p className="text-xs text-muted-foreground mt-1.5">Not happy with it? Make it again once for free, with the same script. Pick another actor or voice below first if you like.</p>
              )}
              <p className="text-xs text-muted-foreground mt-1.5">Made with AI. Mark it as AI-generated when you run it as an ad.</p>
            </div>
          )}

          {latest?.status === "failed" && latest._id !== dismissed && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-sm text-destructive">{latest.error}</p>
              {againButton || (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setDismissed(latest._id)}>
                  Try again
                </Button>
              )}
            </div>
          )}

          {active ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> {PROGRESS[latest.status]}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2" role="radiogroup" aria-label="Actor">
                {REMAKE_ACTORS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-label={a.name}
                    aria-pressed={actorId === a.id}
                    onClick={() => setActorId(a.id)}
                    className={cn(
                      "rounded-lg overflow-hidden border-2 transition-colors",
                      actorId === a.id ? "border-primary" : "border-transparent hover:border-primary/40",
                    )}
                  >
                    <img src={`/actors/${a.id}.jpg`} alt="" className="w-full aspect-[9/16] object-cover" loading="lazy" />
                    <span className="block text-xs py-0.5">{a.name}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {voices.length > 0 && (
                  <FilterSelect
                    label="Voice"
                    value={voiceId}
                    onChange={setVoiceId}
                    options={voices.map((v) => ({ value: v.id, label: [v.name, v.gender, v.accent].filter(Boolean).join(" · ") }))}
                  />
                )}
                <label className="inline-flex items-center gap-1.5 h-10 sm:h-8 px-3 rounded-md border border-border text-sm cursor-pointer hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:border-ring">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  <span>{photo ? photo.name : "Product photo"}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Product photo" onChange={upload} />
                </label>
                <Button size="sm" className="h-10 sm:h-8" onClick={make} disabled={!actorId || !photo || !voiceId || busy || uploading}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                  Make the video
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <RemakeTopUpDialog open={buying} onOpenChange={setBuying} />
    </div>
  );
}
