import { useState } from "react";
import { useMutation } from "convex/react";
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

// Confirms making a Full store launch's theme the live one (api.launch.publishTheme), the same
// step as "Make it my live store" in the LaunchDialog, from the launch list.

export default function MakeLive({ launch, open, onOpenChange }: { launch: Doc<"launches">; open: boolean; onOpenChange: (o: boolean) => void }) {
  const publish = useMutation(api.launch.publishTheme);
  const [busy, setBusy] = useState(false);
  const name = launch.brandName ? `the ${launch.brandName} store` : "this store";

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make {name} live?</AlertDialogTitle>
          <AlertDialogDescription>
            This replaces the theme your customers see now. Your old theme stays in Shopify → Online Store → Themes, so you can switch back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await publish({ launchId: launch._id });
                onOpenChange(false);
              } catch (err) {
                toast.error(errorMessage(err, "Couldn't publish the theme"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : null}
            Yes, make it live
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
