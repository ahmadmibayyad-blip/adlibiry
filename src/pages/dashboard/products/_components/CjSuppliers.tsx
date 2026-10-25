import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { ExternalLink, Truck } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type { CjShipping } from "@/convex/lib/cj.ts";
import ProductImage from "@/components/ProductImage.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { price } from "@/lib/money.ts";
import { anyCountryName, flagOf } from "@/lib/countries.ts";
import { cn } from "@/lib/utils.ts";

// CJ Dropshipping matches for the product (convex/cj.ts): searched by title when the page opens (once, saved for
// everyone), with shipping cost and time to the country the user sells to for the best match.

type Shipping = { from: string; cheapest: CjShipping; fastest: CjShipping } | null;

export default function CjSuppliers({ product, embedded }: { product: Doc<"products">; embedded?: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const findSuppliers = useAction(api.cj.findSuppliers);
  const getShipping = useAction(api.cj.shipping);
  const mine = useQuery(api.onboarding.mine, {});
  const country = mine?.targetCountry ?? "US";
  const matches = product.cjMatches ?? [];
  const [searching, setSearching] = useState(false);
  // Keyed by product and country, so a new one shows "Checking…" without resetting state in the effect.
  const [quote, setQuote] = useState<{ key: string; value: Shipping } | null>(null);
  const started = useRef<string | null>(null);
  const best = matches[0];
  const quoteKey = best ? `${best.pid}|${country}` : "";
  const shipping: Shipping | undefined = quote && quote.key === quoteKey ? quote.value : undefined;

  useEffect(() => {
    if (!isAuthenticated || product.isService || matches.length || started.current === product._id) return;
    started.current = product._id;
    setSearching(true);
    findSuppliers({ productId: product._id })
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [isAuthenticated, product._id, product.isService, matches.length, findSuppliers]);

  const bestPid = best?.pid;
  useEffect(() => {
    if (!isAuthenticated || !bestPid || mine === undefined) return;
    const key = `${bestPid}|${country}`;
    getShipping({ pid: bestPid, country })
      .then((value) => setQuote({ key, value }))
      .catch(() => setQuote({ key, value: null }));
  }, [isAuthenticated, bestPid, country, mine, getShipping]);

  if (!matches.length && !searching) return null;
  const options = shipping ? [shipping.cheapest, ...(shipping.fastest.method !== shipping.cheapest.method ? [shipping.fastest] : [])] : [];

  return (
    <div className={cn(embedded ? "mt-4 pt-3 border-t border-border" : "bg-card border border-border rounded-xl p-4")}>
      <h4 className={cn(embedded ? "text-xs" : "text-sm", "font-semibold mb-1")}>CJ Dropshipping</h4>
      {searching && !matches.length ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner className="w-3.5 h-3.5" /> Looking for this product on CJ…
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">Matched by title. CJ ships from China or its own warehouses, and its price doesn't include shipping.</p>
      )}
      <ul className="divide-y divide-border">
        {matches.map((m, i) => (
          <li key={m.pid} className="py-2.5">
            <div className="flex items-center gap-3">
              <ProductImage src={m.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm line-clamp-1">{m.title}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                  <span className="font-semibold text-foreground">{price(m.price)}</span>
                  {m.listed !== undefined && <span>listed by {m.listed.toLocaleString()} stores</span>}
                  {m.inventory !== undefined && <span>{m.inventory.toLocaleString()} in stock</span>}
                </div>
              </div>
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            </div>
            {i === 0 ? (
              <div className="mt-1.5 ml-[52px] text-xs text-muted-foreground flex items-start gap-1.5">
                <Truck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                {shipping === undefined ? (
                  <span>Checking shipping to {flagOf(country)} {anyCountryName(country)}…</span>
                ) : shipping === null ? (
                  <span>Couldn't get shipping to {anyCountryName(country)}.</span>
                ) : (
                  <span>
                    To {flagOf(country)} {anyCountryName(country)}
                    {shipping.from !== "CN" ? ` from CJ's ${anyCountryName(shipping.from)} warehouse` : " from China"}:{" "}
                    {options.map((o, j) => (
                      <span key={o.method}>
                        {j ? " · " : ""}
                        <span className="text-foreground font-medium">{price(o.priceUsd)}</span> {o.method}
                        {o.days ? ` (${o.days} days)` : ""}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
