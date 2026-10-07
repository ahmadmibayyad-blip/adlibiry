import { BadgeCheck } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { cn } from "@/lib/utils.ts";

// Which independent data sources back this product and whether they agree
// (convex/lib/fusion.ts). It only counts agreement; it never fills gaps.
const FAMILIES: { key: string; label: string; what: string }[] = [
  { key: "registry", label: "Ad registry", what: "Meta's official Ad Library lists its ads as live" },
  { key: "engagement", label: "Ad engagement", what: "ad-spy feeds see views and likes on its ads" },
  { key: "marketplace", label: "Marketplace sales", what: "TikTok Shop, Amazon or the store reports sales (or its Amazon twin sells)" },
];

export default function SourceAgreement({ product }: { product: Doc<"products"> }) {
  const f = product.fusion;
  if (!f) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-sm flex items-center gap-1.5">
          <BadgeCheck className="w-4 h-4 text-primary" />
          Sources
        </h2>
        {product.verifiedWinner ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-good/15 text-good">⭐ Verified winner</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {f.families.length} of 3 sources · agreement {f.confidence}%
          </span>
        )}
      </div>
      <ul className="space-y-1.5 text-xs">
        {FAMILIES.map((fam) => {
          const has = f.families.includes(fam.key);
          return (
            <li key={fam.key} className="flex items-start gap-2">
              <span className={cn("mt-0.5 shrink-0 font-bold", has ? "text-good" : "text-muted-foreground")}>{has ? "✓" : "–"}</span>
              <span className={has ? "" : "text-muted-foreground"}>
                <strong className="font-medium">{fam.label}</strong>: {has ? fam.what : "no data from this source yet"}
              </span>
            </li>
          );
        })}
      </ul>
      {product.marketplaceMatch && (
        <p className="text-xs mt-3">
          <strong className="font-medium">Amazon twin</strong> (matched by image):{" "}
          <a href={product.marketplaceMatch.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {product.marketplaceMatch.title.slice(0, 70)}
          </a>
          {product.marketplaceMatch.unitsPerMonth !== undefined && (
            <span className="text-muted-foreground"> · ~{product.marketplaceMatch.unitsPerMonth.toLocaleString("en-US")} sold / month</span>
          )}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground mt-3">
        {f.adLevel && f.productLevel
          ? "Live ads, rising engagement and real sales agree."
          : f.adLevel
            ? "Live ads with rising engagement; no marketplace sales seen yet."
            : f.productLevel
              ? "Real sales and ads scaling; not confirmed live in the official registry yet."
              : "Not enough sources agree yet to call this cross-validated."}
      </p>
    </div>
  );
}
