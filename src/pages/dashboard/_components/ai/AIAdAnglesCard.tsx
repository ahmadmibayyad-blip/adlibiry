import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { MessageSquareText, Sparkles, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import AIFeatureGate from "./AIFeatureGate.tsx";

type Angle = { hook: string; angle: string; description: string };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
      title="Copy hook"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function AIAdAnglesCard({
  title,
  description,
  category,
}: {
  title: string;
  description: string;
  category: string;
}) {
  const generateAdAngles = useAction(api.ai.generateAdAngles);
  const [angles, setAngles] = useState<Angle[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await generateAdAngles({ title, description, category });
      setAngles(res.angles);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate ad angles";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AIFeatureGate>
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">AI Ad Angle Generator</h3>
          </div>
          {!angles && (
            <Button size="sm" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {isLoading ? "Writing..." : "Generate 5 Angles"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          5 scroll-stopping hooks and creative angles for your next ad campaign.
        </p>

        {angles && (
          <div className="pt-3 border-t border-border space-y-2.5">
            {angles.map((a, i) => (
              <div key={i} className="bg-muted rounded-lg p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                    {a.angle}
                  </span>
                  <CopyButton text={a.hook} />
                </div>
                <p className="text-sm font-semibold leading-snug mb-1">"{a.hook}"</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{a.description}</p>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={isLoading} className="w-full">
              {isLoading ? <Spinner className="mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              Generate new angles
            </Button>
          </div>
        )}
      </div>
    </AIFeatureGate>
  );
}
