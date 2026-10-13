import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { BadgeDollarSign } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Clears prices no store product has (over $2,000): local currencies imported as dollars,
// with the GMV and revenue estimates built on them (convex/admin/importCleanup.ts).
export default function ClearImpossiblePrices() {
  const clear = useMutation(api.admin.importCleanup.clearImpossiblePrices);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (
      !window.confirm(
        "Clear prices over $2,000 (a local currency like rupiah imported as dollars), with those products' GMV and revenue estimates? They'll show as unknown until you import their file again.",
      )
    )
      return;
    setBusy(true);
    try {
      let total = 0;
      let cursor: string | null = null;
      for (;;) {
        const r: { fixed: number; cursor: string; isDone: boolean } = await clear({ cursor });
        total += r.fixed;
        if (r.isDone) break;
        cursor = r.cursor;
      }
      if (total) toast.success(`Cleared the wrong prices of ${total.toLocaleString()} products`);
      else toast.info("No products with impossible prices found");
    } catch {
      toast.error("Couldn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title="Products priced over $2,000: a local currency imported as dollars">
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <BadgeDollarSign className="w-4 h-4 mr-1.5" />}
      Fix impossible prices
    </Button>
  );
}
