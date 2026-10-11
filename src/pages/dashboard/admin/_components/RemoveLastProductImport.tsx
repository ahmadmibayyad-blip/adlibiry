import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";

// Removes the products the most recent product CSV import added.
export default function RemoveLastProductImport() {
  const last = useQuery(api.admin.importCleanup.lastProductImport, {});
  const remove = useMutation(api.admin.importCleanup.removeProductImport);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(0);
  if (!last) return null;

  const when = new Date(last.at).toLocaleString();
  const run = async () => {
    if (!window.confirm(`Delete the products the last "${last.name}" CSV import added (${when})? Products it only updated stay. This can't be undone.`)) return;
    setBusy(true);
    setRemoved(0);
    try {
      let total = 0;
      let before = last.at + 1;
      let prev: number | undefined;
      for (;;) {
        const r = await remove({ name: last.name, before, last: prev });
        total += r.deleted;
        setRemoved(total);
        if (r.done) break;
        before = r.before;
        prev = r.last;
      }
      toast.success(`Removed ${total} products from the last "${last.name}" import`);
    } catch {
      toast.error("Couldn't remove the import. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} title={`Imported ${when}`}>
      {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : <Undo2 className="w-4 h-4 mr-1.5" />}
      {busy ? `Removing… ${removed}` : `Remove last import (${last.name})`}
    </Button>
  );
}
