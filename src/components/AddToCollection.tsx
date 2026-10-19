import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Check, FolderPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { cn } from "@/lib/utils.ts";
import { errorMessage } from "@/lib/errorMessage.ts";

type Kind = "ad" | "store" | "product";

// "Collection" button: tick the user's named collections this ad, store or
// product belongs in, or start a new one with it (convex/collections.ts).
export default function AddToCollection({
  kind,
  refId,
  className,
  iconOnly,
  defaultOpen,
}: {
  kind: Kind;
  refId: string;
  className?: string;
  iconOnly?: boolean;
  /** Opens at once (Offer Search adds the store first, then shows this). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The collection being ticked or unticked, so a quick second tap doesn't undo the first.
  const [pending, setPending] = useState<Id<"collections"> | null>(null);
  const list = useQuery(api.collections.mine, { kind, refId });
  const toggle = useMutation(api.collections.toggleItem);
  const create = useMutation(api.collections.create);
  const inAny = list?.some((c) => c.has);

  const onToggle = async (id: Id<"collections">, label: string) => {
    if (pending) return;
    setPending(id);
    try {
      const r = await toggle({ id, kind, refId });
      toast.success(r.added ? `Added to ${label}` : `Removed from ${label}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update the collection"));
    } finally {
      setPending(null);
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await create({ name, item: { kind, refId } });
      toast.success(`Added to ${name.trim()}`);
      setName("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the collection"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? "icon" : "default"}
          className={cn(iconOnly ? "size-10 sm:size-9" : "h-10 sm:h-9", inAny && "border-primary/50 text-primary", className)}
          aria-label="Add to collection"
          title="Add to collection"
          onClick={(e) => e.stopPropagation()}
        >
          <FolderPlus className={cn("w-4 h-4", !iconOnly && "mr-2")} />
          {!iconOnly && "Collection"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground">Add to collection</div>
        <div className="max-h-60 overflow-y-auto">
          {list === undefined ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">No collections yet. Name your first one below.</div>
          ) : (
            list.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => onToggle(c._id, c.name)}
                disabled={pending !== null}
                aria-pressed={c.has}
                className="flex min-h-10 sm:min-h-0 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary cursor-pointer disabled:cursor-wait disabled:opacity-70"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    c.has ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {c.has && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{c.itemCount}</span>
              </button>
            ))
          )}
        </div>
        <form onSubmit={onCreate} className="mt-2 flex gap-1.5 border-t border-border pt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New collection"
            maxLength={60}
            className="h-10 sm:h-8 text-sm"
            aria-label="New collection name"
          />
          <Button type="submit" size="sm" className="h-10 sm:h-8 shrink-0" disabled={!name.trim() || busy} aria-label="Create collection">
            {busy ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
