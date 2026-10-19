import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Folder, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";
import AdCard from "../../ad-spy/_components/AdCard.tsx";
import AdDetailModal from "../../ad-spy/_components/AdDetailModal.tsx";
import StoreCard from "../../stores/_components/StoreCard.tsx";
import StoreDetailModal from "../../stores/_components/StoreDetailModal.tsx";
import ProductCard from "../../_components/ProductCard.tsx";

type Kind = "ad" | "store" | "product";
const PARAM = "collection";
const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5";

function itemsLabel(n: number) {
  return n === 1 ? "1 item" : `${n} items`;
}

// Saved → Collections: the user's named collections; ?collection=<id> opens one.
export default function Collections() {
  const [params, setParams] = useSearchParams();
  const openId = params.get(PARAM) as Id<"collections"> | null;
  const show = (id: Id<"collections"> | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set(PARAM, id);
    else next.delete(PARAM);
    setParams(next);
  };
  return openId ? <CollectionView id={openId} onBack={() => show(null)} /> : <CollectionList onOpen={show} />;
}

function NewCollection() {
  const create = useMutation(api.collections.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await create({ name });
      setName("");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create the collection"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-2 max-w-md mb-6">
      <Input className="h-10 sm:h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection, e.g. Pet winners" maxLength={60} aria-label="New collection name" />
      <Button type="submit" className="h-10 sm:h-9" disabled={!name.trim() || busy}>
        {busy ? <Spinner className="w-4 h-4 mr-2" /> : <FolderPlus className="w-4 h-4 mr-2" />}Create
      </Button>
    </form>
  );
}

function CollectionList({ onOpen }: { onOpen: (id: Id<"collections">) => void }) {
  const list = useQuery(api.collections.mine, {});
  return (
    <>
      <NewCollection />
      {list === undefined ? (
        <div className={GRID}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Folder /></EmptyMedia>
            <EmptyTitle>No collections yet</EmptyTitle>
            <EmptyDescription>
              Group ads, stores and products by idea, like "Pet winners" or "Test next week". Create one here, or use the
              Collection button on any ad, store or product.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className={GRID}>
          {list.map((c) => (
            <button
              key={c._id}
              type="button"
              onClick={() => onOpen(c._id)}
              className="group text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all cursor-pointer"
            >
              <div className={cn("grid gap-0.5 aspect-[16/9] bg-muted", c.covers.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
                {c.covers.length === 0 ? (
                  <div className="col-span-3 flex items-center justify-center text-muted-foreground">
                    <Folder className="w-8 h-8" />
                  </div>
                ) : (
                  c.covers.map((src, i) => (
                    <img key={i} src={src} alt="" loading="lazy" className={i === 0 && c.covers.length === 1 ? "col-span-3 w-full h-full object-cover" : "w-full h-full object-cover"} />
                  ))
                )}
              </div>
              <div className="p-3.5">
                <div className="font-semibold truncate group-hover:text-primary transition-colors">{c.name}</div>
                <div className="text-xs text-muted-foreground">{itemsLabel(c.itemCount)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function RemoveItem({ id, kind, refId }: { id: Id<"collections">; kind: Kind; refId: string }) {
  const toggle = useMutation(api.collections.toggleItem);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await toggle({ id, kind, refId });
        } catch (e) {
          toast.error(errorMessage(e, "Couldn't remove it"));
          setBusy(false);
        }
      }}
      className="mt-1 inline-flex min-h-10 sm:min-h-0 items-center gap-1 rounded-md py-1.5 pr-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer disabled:cursor-wait disabled:opacity-60"
    >
      <X className="w-3 h-3" />Remove from collection
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold mb-3">
        {title} <span className="text-muted-foreground font-normal">{count}</span>
      </h2>
      <div className={GRID}>{children}</div>
    </section>
  );
}

function CollectionView({ id, onBack }: { id: Id<"collections">; onBack: () => void }) {
  const c = useQuery(api.collections.get, { id });
  const rename = useMutation(api.collections.rename);
  const remove = useMutation(api.collections.remove);
  const [editing, setEditing] = useState<string | null>(null);
  const [ad, setAd] = useState<Doc<"ads"> | null>(null);
  const [store, setStore] = useState<Doc<"stores"> | null>(null);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 -ml-2 h-10 sm:h-8">
      <ArrowLeft className="w-4 h-4 mr-1.5" />All collections
    </Button>
  );
  if (c === undefined) return <>{back}<Skeleton className="h-8 w-56 mb-6" /></>;
  if (c === null) {
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">This collection was deleted.</p>
      </>
    );
  }

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (editing === null) return;
    try {
      await rename({ id, name: editing });
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't rename it"));
    }
  };

  const empty = c.ads.length + c.stores.length + c.products.length === 0;
  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {editing !== null ? (
          <form onSubmit={saveName} className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={60} className="h-10 sm:h-9 w-full sm:w-64" aria-label="Collection name" />
            <Button type="submit" size="sm" className="h-10 sm:h-8">Save</Button>
            <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setEditing(null)}>Cancel</Button>
          </form>
        ) : (
          <>
            <h2 className="text-xl font-bold mr-1">{c.name}</h2>
            <span className="text-sm text-muted-foreground">{itemsLabel(c.itemCount)}</span>
            <Button variant="ghost" size="icon" className="size-10 sm:size-9" onClick={() => setEditing(c.name)} aria-label="Rename collection">
              <Pencil className="w-4 h-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-10 sm:size-9" aria-label="Delete collection">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{c.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The collection goes away. The ads, stores and products in it stay in AdSpy Pro, and anything you saved or track stays saved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await remove({ id });
                        onBack();
                      } catch (e) {
                        toast.error(errorMessage(e, "Couldn't delete it"));
                      }
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      {empty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Folder /></EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>Open any ad, store or product and use its Collection button to add it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Section title="Ads" count={c.ads.length}>
            {c.ads.map((a) => (
              <div key={a._id}>
                <AdCard ad={a} onClick={() => setAd(a)} />
                <RemoveItem id={id} kind="ad" refId={a._id} />
              </div>
            ))}
          </Section>
          <Section title="Stores" count={c.stores.length}>
            {c.stores.map((s) => (
              <div key={s._id}>
                <StoreCard store={s} onClick={() => setStore(s)} />
                <RemoveItem id={id} kind="store" refId={s._id} />
              </div>
            ))}
          </Section>
          <Section title="Products" count={c.products.length}>
            {c.products.map((p) => (
              <div key={p._id}>
                <ProductCard product={p} />
                <RemoveItem id={id} kind="product" refId={p._id} />
              </div>
            ))}
          </Section>
        </>
      )}
      {(c.gone > 0 || c.more) && (
        <p className="text-xs text-muted-foreground">
          {c.gone > 0 && `${itemsLabel(c.gone)} in this collection no longer exist${c.gone === 1 ? "s" : ""} in AdSpy Pro. `}
          {c.more && "Showing the newest 200."}
        </p>
      )}

      <AdDetailModal ad={ad} open={!!ad} onOpenChange={(o) => !o && setAd(null)} />
      <StoreDetailModal store={store} open={!!store} onOpenChange={(o) => !o && setStore(null)} />
    </>
  );
}
