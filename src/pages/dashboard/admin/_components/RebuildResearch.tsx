import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { LineChart } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Rebuilds Product Research (Trends, Category Explorer) and the home charts from real ads and products now,
// instead of waiting for the daily pipeline (convex/research.ts), and says why when it fails.
export default function RebuildResearch() {
  const rebuild = useAction(api.research.rebuildNow);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await rebuild({});
      if ("error" in r) toast.error(`Research rebuild failed: ${r.error}`, { duration: 20000 });
      else toast.success(`Rebuilt research: ${r.trends} trends and ${r.categories} categories from ${r.ads.toLocaleString()} ads and ${r.products.toLocaleString()} products`);
    } catch {
      toast.error("Couldn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title="Product Research trends and categories from real ads and products">
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <LineChart className="w-4 h-4 mr-1.5" />}
      Rebuild research
    </Button>
  );
}
