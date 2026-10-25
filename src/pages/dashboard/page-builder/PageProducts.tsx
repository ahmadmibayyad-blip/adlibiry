import { useState } from "react";
import { useAction } from "convex/react";
import { Package, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { MAX_PAGE_PRODUCTS } from "@/convex/lib/screenPage.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Screenshot to page → Products: links of the products the page should sell (your Shopify store, another store
// or AliExpress), read like Launch from a link (convex/productImport.ts). The AI builds the page with their names,
// prices and photos, and their buttons go to them.

export type PickedProduct = { productId: Id<"importedProducts">; title: string; imageUrl: string; url: string };

export default function PageProducts({ value, onChange }: { value: PickedProduct[]; onChange: (products: PickedProduct[]) => void }) {
  const importLink = useAction(api.productImport.importLink);
  const [link, setLink] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const raw = link.trim();
      const r = await importLink({ url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
      if (!value.some((p) => p.productId === r.productId)) onChange([...value, r]);
      setLink("");
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e, "We couldn't read that product."));
    } finally {
      setBusy(false);
    }
  };

  const full = value.length >= MAX_PAGE_PRODUCTS;
  const showInput = open || !value.length;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Package className="w-4 h-4 text-primary" /> Products <span className="font-normal text-muted-foreground">(optional)</span>
      </p>
      {value.length ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((p, i) => (
            <li key={p.productId} className="flex items-center gap-2 rounded-lg border border-border bg-background pl-1 pr-1.5 py-1 max-w-72">
              {p.imageUrl ? <img width={36} height={36} src={p.imageUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0" /> : null}
              <span className="text-xs min-w-0">
                <span className="block truncate font-medium">{p.title}</span>
                <span className="block text-muted-foreground">{i === 0 && value.length > 1 ? "Main product" : `Product ${i + 1}`}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${p.title}`}
                onClick={() => onChange(value.filter((x) => x.productId !== p.productId))}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showInput && !full ? (
        <div className="flex gap-2">
          <Input
            type="url"
            name="product-link"
            aria-label="Product link"
            autoComplete="off"
            spellCheck={false}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            disabled={busy}
            placeholder="Product link: your store, another store or AliExpress"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={() => void add()} disabled={busy || !link.trim()}>
            {busy ? <Spinner className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {busy ? "Reading it…" : "Add"}
          </Button>
        </div>
      ) : null}
      {!showInput && !full ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add product
        </Button>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">
        The page shows these instead of the screenshot's products: their names, prices and photos, and every buy button goes to them. Up to {MAX_PAGE_PRODUCTS}; the first
        is the main one. AliExpress links can take up to a minute.
      </p>
    </div>
  );
}
