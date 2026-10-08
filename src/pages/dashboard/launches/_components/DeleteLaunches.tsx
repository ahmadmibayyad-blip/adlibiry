import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Confirms deleting launches (convex/launchCleanup.ts): says what goes from
// AdSpy Pro and from Shopify, with deleting the Shopify product as an opt-in.

export default function DeleteLaunches({ launches, open, onOpenChange }: { launches: Doc<"launches">[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const remove = useAction(api.launchCleanup.remove);
  const [busy, setBusy] = useState(false);
  const [withProducts, setWithProducts] = useState(false);
  const n = launches.length;
  const themes = launches.filter((l) => l.themeId && !l.themeLive).length;
  const products = launches.filter((l) => l.status === "published" && l.shopifyProductId && !l.themeLive).length;
  const one = n === 1;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{one ? "Delete this launch?" : `Delete ${n} launches?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {one ? "It's removed" : "They're removed"} from AdSpy Pro, with {one ? "its" : "their"} AI photos and ad images.
                {themes ? ` ${themes === 1 ? "Its unused theme is" : `${themes} unused themes are`} deleted from Shopify, which frees space (Shopify allows 20 themes).` : ""}
              </p>
              <p>A store you made live is never touched. Your store's pages and menus stay.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {products ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={withProducts} onChange={(e) => setWithProducts(e.target.checked)} />
            <span>
              Also delete {products === 1 ? "the product" : `the ${products} products`} from Shopify
              <span className="block text-xs text-muted-foreground">Products another launch still uses are kept. This can't be undone.</span>
            </span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await remove({ launchIds: launches.map((l) => l._id), deleteProducts: withProducts });
                const parts = [
                  `${r.removed} launch${r.removed === 1 ? "" : "es"} deleted`,
                  r.themesDeleted ? `${r.themesDeleted} theme${r.themesDeleted === 1 ? "" : "s"}` : "",
                  r.productsDeleted ? `${r.productsDeleted} product${r.productsDeleted === 1 ? "" : "s"}` : "",
                ].filter(Boolean);
                toast.success(parts.join(", "), r.notes.length ? { description: r.notes.join(" ") } : undefined);
                onOpenChange(false);
              } catch (err) {
                toast.error(errorMessage(err, "Couldn't delete"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : null}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
