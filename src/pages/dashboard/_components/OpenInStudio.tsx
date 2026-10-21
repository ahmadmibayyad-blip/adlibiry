import { ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

// Ad page: the AI tools live in AI Studio now (/dashboard/studio); this opens it for the ad in a new tab.

export default function OpenInStudio({ adId }: { adId: string }) {
  return (
    <div className="mt-6 rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          <Sparkles className="w-4 h-4 text-primary" /> Remake this ad with AI
        </div>
        <p className="text-sm text-muted-foreground">Analyse this video, write your version, and make an AI video of it.</p>
      </div>
      <Button asChild size="sm" className="h-10 sm:h-8">
        <a href={`/dashboard/studio?tab=remake&ad=${encodeURIComponent(adId)}`} target="_blank" rel="noopener">
          Open in AI Studio
          <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
        </a>
      </Button>
    </div>
  );
}
