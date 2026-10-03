import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { PackageX } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Removes product listings that were imported as ads (product-finder exports
// uploaded through the ads CSV import): they have no likes or views.
export default function RemoveProductListingAds() {
  const remove = useMutation(api.admin.importCleanup.removeProductListingAds);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (
      !window.confirm(
        "Remove every CSV-imported ad that is really a product listing (sales columns like Items Sold, GMV or Product Price, and no likes or views)? This can't be undone.",
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
      if (total) toast.success(`Removed ${total.toLocaleString()} product listings from Ads`);
      else toast.info("No product listings found in Ads");
    } catch {
      toast.error("Couldn't finish removing them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title="Product-finder rows imported as ads">
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <PackageX className="w-4 h-4 mr-1.5" />}
      Remove product listings
    </Button>
  );
}
