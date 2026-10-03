import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Removes every ad from the most recent ad CSV import.
export default function RemoveLastAdImport() {
  const last = useQuery(api.admin.importCleanup.lastAdImport, {});
  const remove = useMutation(api.admin.importCleanup.removeAdImport);
  const [busy, setBusy] = useState(false);
  if (!last) return null;

  const when = new Date(last.at).toLocaleString();
  const run = async () => {
    if (!window.confirm(`Delete the ${last.count} ads imported from CSV on ${when}? This can't be undone.`)) return;
    setBusy(true);
    try {
      let total = 0;
      for (;;) {
        const r = await remove({ at: last.at });
        total += r.deleted;
        if (r.remaining === 0 || r.deleted === 0) break;
      }
      toast.success(`Removed ${total} ads from the last CSV import`);
    } catch {
      toast.error("Couldn't remove the import. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title={`Imported ${when}`}>
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <Undo2 className="w-4 h-4 mr-1.5" />}
      Remove last CSV import ({last.count})
    </Button>
  );
}
