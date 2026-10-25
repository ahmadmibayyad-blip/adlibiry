import { useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Asks before an action that can't be undone: the trigger (a Button) opens the dialog, the confirm button runs
// `onConfirm` and closes it once that resolves. A thrown error shows as a toast and leaves the dialog open.
export default function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  errorLabel = "Something went wrong",
  destructive = true,
  onConfirm,
}: {
  children: ReactElement;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  errorLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } catch (err) {
                toast.error(errorMessage(err, errorLabel));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="w-4 h-4 mr-1.5" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
