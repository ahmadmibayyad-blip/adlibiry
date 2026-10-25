import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { Copy, ExternalLink, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { price } from "@/lib/money.ts";
import { WHOLESALE_MIN_SHARE } from "@/convex/lib/marketplaceMatch.ts";
import { Spinner } from "@/components/ui/spinner.tsx";
import CjSuppliers from "./CjSuppliers.tsx";
import { isAccessoryOf } from "@/convex/lib/aliexpress.ts";

// AliExpress listings that look like the product photo (convex/aliexpressImage.ts),
// the top AliExpress suppliers matched by title (convex/aliexpress.ts), and 1688
// wholesale offers matched by image (convex/fusion.ts, via Nexscope). A product without AliExpress suppliers gets searched when its
// page opens (aliexpress.findSuppliers); the matches then appear here. CJ Dropshipping matches below (CjSuppliers.tsx).
export default function SuppliersSection({ product }: { product: Doc<"products"> }) {
  const track = useMutation(api.events.track);
  const findSuppliers = useAction(api.aliexpress.findSuppliers);
  const findByPicture = useAction(api.aliexpressImage.findByPicture);
  const { isAuthenticated } = useConvexAuth();
  const matches = product.supplierMatches ?? [];
  // A listing found both ways shows once, under "by picture".
  // Saved before the accessory filter (lib/aliexpress.ts isAccessoryOf), a row can still be a part.
  const pictures = (product.pictureMatches ?? []).filter((m) => !isAccessoryOf(product.title, m.title));
  const titleOnly = matches.filter((m) => !pictures.some((p) => p.url === m.url));
  const [picLookup, setPicLookup] = useState<"idle" | "searching">("idle");
  const picStarted = useRef<string | null>(null);
  const needsPicture = isAuthenticated && !product.isService && pictures.length === 0 && !!product.imageUrl;
  // Offers saved before the part-price filter (convex/lib/marketplaceMatch.ts) can still be filter pads or spare parts.
  const wholesaleFloor = product.price ? product.price * WHOLESALE_MIN_SHARE : 0;
  const wholesale = (product.wholesaleMatches ?? []).filter((w) => w.priceUsd >= wholesaleFloor);
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

  // The server decides whether it's due (once, again after 30 days); the answer lands on the product.
  useEffect(() => {
    if (!needsPicture || picStarted.current === product._id) return;
    picStarted.current = product._id;
    setPicLookup("searching");
    findByPicture({ productId: product._id })
      .catch(() => undefined)
      .finally(() => setPicLookup("idle"));
  }, [needsPicture, product._id, findByPicture]);

  if (product.isService) return null;
  if (!matches.length && !pictures.length && !wholesale.length && lookup === "idle" && picLookup === "idle") return <CjSuppliers product={product} />;
  const searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(product.title.slice(0, 80))}`;
  const opened = () => track({ type: "supplier_click", productId: product._id }).catch(() => {});
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm mb-1">Suppliers</h3>
      {pictures.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold mb-1">Matched by picture</h4>
          <p className="text-xs text-muted-foreground mb-1">
            AliExpress listings that look like this product's photo, most similar first. Check the listing's photos and variants before you order.
          </p>
          <ul className="divide-y divide-border">
            {pictures.map((m) => (
              <SupplierRow key={m.url} m={m} onOpen={opened} />
            ))}
          </ul>
        </div>
      )}
      {!pictures.length && picLookup === "searching" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner className="w-3.5 h-3.5" /> Searching AliExpress with the product photo…
        </p>
      )}
      {pictures.length > 0 && titleOnly.length > 0 && <h4 className="text-xs font-semibold mb-1 pt-3 border-t border-border">Matched by title</h4>}
      {matches.length > 0 && !pictures.length && (
        <p className="text-xs text-muted-foreground mb-3">
          AliExpress listings that match this product by title. Check photos and shipping times on the listing before you order.
        </p>
      )}
      {!matches.length && lookup === "searching" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner className="w-3.5 h-3.5" /> Looking for this product on AliExpress… (up to a minute)
        </p>
      )}
      {!matches.length && !pictures.length && (lookup === "none" || lookup === "unavailable") && (
        <p className="text-xs text-muted-foreground py-1">
          {lookup === "none" ? "No close AliExpress match found by title." : "We couldn't search AliExpress for it right now."}{" "}
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" onClick={opened} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Search className="w-3 h-3" aria-hidden="true" /> Search AliExpress yourself
          </a>
        </p>
      )}
      <ul className="divide-y divide-border">
        {titleOnly.map((m) => (
          <SupplierRow key={m.url} m={m} onOpen={opened} ordersLabel="orders (30 days)" />
        ))}
      </ul>
      {wholesale.length > 0 && (
        <div className={matches.length || pictures.length ? "mt-4 pt-3 border-t border-border" : ""}>
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
                    {w.moq !== undefined && <span>min. order {w.moq.toLocaleString()}</span>}
                    {w.monthlySales !== undefined && <span>{w.monthlySales.toLocaleString()} sold / month</span>}
                  </div>
                </div>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={opened}
                  className="inline-flex items-center gap-1 h-10 sm:h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <CjSuppliers product={product} embedded />
    </div>
  );
}

type Supplier = { title: string; price: number; url: string; imageUrl?: string; rating?: number; orders?: number };

function SupplierRow({ m, onOpen, ordersLabel = "orders" }: { m: Supplier; onOpen: () => void; ordersLabel?: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
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
          {m.orders !== undefined && <span>{m.orders.toLocaleString()} {m.orders === 1 ? ordersLabel.replace(/^orders/, "order") : ordersLabel}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={onOpen}
          className="inline-flex items-center gap-1 h-10 sm:h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open
        </a>
        <button
          type="button"
          aria-label="Copy supplier link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(m.url);
              onOpen();
              toast.success("Supplier link copied");
            } catch {
              toast.error("Couldn't copy the link. Open it instead.");
            }
          }}
          className="inline-flex items-center justify-center size-10 sm:size-8 rounded-md border border-border hover:bg-muted cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}
