// Shared building blocks for the WinningHunter-style filter panels
// (Ad Spy, Winning Products): chips, checkboxes, range helpers and
// per-browser saved searches.
import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { readJson, writeJson } from "@/lib/filterUtils.ts";


export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs border cursor-pointer whitespace-nowrap transition-colors shrink-0",
        on ? "bg-primary/15 border-primary text-primary font-medium" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center gap-2 h-8 px-1 text-xs cursor-pointer select-none whitespace-nowrap" title={hint}>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

type Saved<F> = { name: string; filters: F; search: string };

// "Save current search" + "Saved searches (n)" — stored per browser.
export function SavedSearches<F>({
  storageKey,
  filters,
  search,
  onApply,
}: {
  storageKey: string;
  filters: F;
  search: string;
  onApply: (filters: F, search: string) => void;
}) {
  const [saved, setSaved] = useState<Saved<F>[]>(() => readJson<Saved<F>[]>(storageKey, []));
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const next = [{ name: n, filters, search }, ...saved.filter((s) => s.name !== n)].slice(0, 20);
    setSaved(next);
    writeJson(storageKey, next);
    setName("");
    setOpen(false);
    toast.success(`Saved "${n}"`);
  };
  const remove = (n: string) => {
    const next = saved.filter((s) => s.name !== n);
    setSaved(next);
    writeJson(storageKey, next);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Bookmark className="w-3.5 h-3.5 mr-1.5" />Save current search
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="end">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. DK pets video" className="h-8 text-xs" />
            <Button type="submit" size="sm" className="h-8" disabled={!name.trim()}>Save</Button>
          </form>
        </PopoverContent>
      </Popover>
      {saved.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">Saved searches ({saved.length})</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-1" align="end">
            {saved.map((s) => (
              <div key={s.name} className="flex items-center gap-1 rounded-md hover:bg-muted">
                <button className="flex-1 text-left text-sm px-2 py-1.5 truncate cursor-pointer" onClick={() => onApply(s.filters, s.search)}>
                  {s.name}
                </button>
                <button className="p-1.5 text-muted-foreground hover:text-destructive cursor-pointer" title="Delete" onClick={() => remove(s.name)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
