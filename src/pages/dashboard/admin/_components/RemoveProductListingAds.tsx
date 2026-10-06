import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { PackageX } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Removes CSV-imported ads with no data: product listings imported as ads and
// ads from files with no likes, views or dates.
export default function RemoveProductListingAds() {
  const remove = useMutation(api.admin.importCleanup.removeProductListingAds);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (
      !window.confirm(
        "Remove CSV-imported ads with no data: product listings (Items Sold, GMV or Product Price, no likes or views) and ads with no likes, views, comments or days running? Ads with any numbers are kept. This can't be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      let total = 0;
      let cursor: string | null = null;
      for (;;) {
        const r: { deleted: number; cursor: string; isDone: boolean } = await remove({ cursor });
        total += r.deleted;
        if (r.isDone) break;
        cursor = r.cursor;
      }
      if (total) toast.success(`Removed ${total.toLocaleString()} empty ads`);
      else toast.info("No empty CSV ads found");
    } catch {
      toast.error("Couldn't finish removing them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title="CSV ads with no numbers, and product listings imported as ads">
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <PackageX className="w-4 h-4 mr-1.5" />}
      Remove empty CSV ads
    </Button>
  );
}
