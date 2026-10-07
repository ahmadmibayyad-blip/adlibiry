import { useMutation } from "convex/react";
import { Copy, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { price } from "@/lib/money.ts";

// Top AliExpress suppliers for the product (convex/aliexpress.ts), matched by
// title. Hidden until a search has found some.
export default function SuppliersSection({ product }: { product: Doc<"products"> }) {
  const track = useMutation(api.events.track);
  const matches = product.supplierMatches ?? [];
  if (!matches.length) return null;
  const opened = () => track({ type: "supplier_click", productId: product._id }).catch(() => {});
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm mb-1">Suppliers</h3>
      <p className="text-xs text-muted-foreground mb-3">
        AliExpress listings that match this product by title. Check photos and shipping times on the listing before you order.
      </p>
      <ul className="divide-y divide-border">
        {matches.map((m) => (
          <li key={m.url} className="flex items-center gap-3 py-2.5">
            <ProductImage src={m.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium line-clamp-1">{m.title}</div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                <span className="font-semibold text-foreground">{price(m.price)}</span>
                {m.rating !== undefined && (
                  <span className="inline-flex items-center gap-0.5">
                    <Star className="w-3 h-3" aria-hidden="true" />
                    {m.rating}% positive
                  </span>
                )}
                {m.orders !== undefined && <span>{m.orders.toLocaleString("en-US")} orders (30 days)</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={opened}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
              <button
                type="button"
                aria-label="Copy supplier link"
                onClick={() => {
                  navigator.clipboard?.writeText(m.url);
                  opened();
                  toast.success("Supplier link copied");
                }}
                className="inline-flex items-center h-8 px-2 rounded-md border border-border hover:bg-muted cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
