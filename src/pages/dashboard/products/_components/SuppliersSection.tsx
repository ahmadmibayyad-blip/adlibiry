import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { Copy, ExternalLink, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { price } from "@/lib/money.ts";
import { Spinner } from "@/components/ui/spinner.tsx";

// Top AliExpress suppliers for the product (convex/aliexpress.ts), matched by
// title, and 1688 wholesale offers matched by image (convex/fusion.ts, via
// Nexscope). A product without AliExpress suppliers gets searched when its
// page opens (aliexpress.findSuppliers); the matches then appear here.
export default function SuppliersSection({ product }: { product: Doc<"products"> }) {
  const track = useMutation(api.events.track);
  const findSuppliers = useAction(api.aliexpress.findSuppliers);
  const { isAuthenticated } = useConvexAuth();
  const matches = product.supplierMatches ?? [];
  const wholesale = product.wholesaleMatches ?? [];
  const [lookup, setLookup] = useState<"idle" | "searching" | "none" | "unavailable">("idle");
  const started = useRef<string | null>(null);
  const needsLookup = isAuthenticated && !product.isService && matches.length === 0;

  useEffect(() => {
    if (!needsLookup || started.current === product._id) return;
    started.current = product._id;
    setLookup("searching");
    findSuppliers({ productId: product._id })
      // Searched now or recently with no match → "none"; not searched (limit, failure, not set up) → "unavailable".
      .then((r) => setLookup("found" in r || r.skipped === "searched recently" ? "none" : "unavailable"))
      .catch(() => setLookup("unavailable"));
  }, [needsLookup, product._id, findSuppliers]);

  if (product.isService || (!matches.length && !wholesale.length && lookup === "idle")) return null;
  const searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.title.slice(0, 80))}`;
  const opened = () => track({ type: "supplier_click", productId: product._id }).catch(() => {});
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm mb-1">Suppliers</h3>
      {matches.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          AliExpress listings that match this product by title. Check photos and shipping times on the listing before you order.
        </p>
      )}
      {!matches.length && lookup === "searching" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner className="w-3.5 h-3.5" /> Looking for this product on AliExpress… (up to a minute)
        </p>
      )}
      {!matches.length && (lookup === "none" || lookup === "unavailable") && (
        <p className="text-xs text-muted-foreground py-1">
          {lookup === "none" ? "No close AliExpress match found by title." : "We couldn't search AliExpress for it right now."}{" "}
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" onClick={opened} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Search className="w-3 h-3" aria-hidden="true" /> Search AliExpress yourself
          </a>
        </p>
      )}
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
      {wholesale.length > 0 && (
        <div className={matches.length ? "mt-4 pt-3 border-t border-border" : ""}>
          <h4 className="text-xs font-semibold mb-1">Wholesale on 1688</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Chinese wholesale offers that look like this product (matched by image). Prices are converted from yuan and exclude shipping; most
            need an agent to order.
          </p>
          <ul className="divide-y divide-border">
            {wholesale.map((w) => (
              <li key={w.url} className="flex items-center gap-3 py-2">
                <ProductImage src={w.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm line-clamp-1">{w.title}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                    <span className="font-semibold text-foreground">{price(w.priceUsd)}</span>
                    {w.moq !== undefined && <span>min. order {w.moq.toLocaleString("en-US")}</span>}
                    {w.monthlySales !== undefined && <span>{w.monthlySales.toLocaleString("en-US")} sold / month</span>}
                  </div>
                </div>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={opened}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
