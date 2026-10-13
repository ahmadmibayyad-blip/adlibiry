import type { ReactNode } from "react";
import { Check, ExternalLink, Gift, LayoutList, ListChecks, Package, ScanSearch, Star, Tag, Truck } from "lucide-react";
import type { BundleTier, PageSection, Teardown, TierDeal } from "@/convex/lib/storeTeardown.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";

// Store Teardown (convex/lib/storeTeardown.ts): what the store's main product page shows,
// read from its HTML and /products/<handle>.js. Shown as "the page shows", never as verified.

function money(amount: number, currency?: string) {
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    /* unknown currency code */
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (currency ? ` ${currency}` : "");
}

function dealText(deal: TierDeal, currency?: string) {
  switch (deal.kind) {
    case "percent":
      return `${deal.value}% off`;
    case "price":
      return `${money(deal.value, currency)} for the tier`;
    case "amount":
      return `${money(deal.value, currency)} off`;
    case "buyXgetY":
      return `Buy ${deal.buy} get ${deal.get} free`;
    case "bundle":
      return `${deal.items}-product bundle`;
    default:
      return "Full price";
  }
}

/** Consecutive sections of one kind as one line ("Image with text ×3"). */
function groupSections(sections: PageSection[]) {
  const out: { label: string; count: number }[] = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    if (last && last.label === s.label) last.count++;
    else out.push({ label: s.label, count: 1 });
  }
  return out;
}

function Heading({ icon: Icon, children }: { icon: typeof Tag; children: ReactNode }) {
  return (
    <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </h5>
  );
}

function TierRow({ tier, currency }: { tier: BundleTier; currency?: string }) {
  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <div className="font-medium flex flex-wrap items-center gap-1.5">
          {tier.title}
          {tier.badge ? <Badge variant="secondary">{tier.badge}</Badge> : null}
          {tier.preselected ? <span className="text-[11px] text-muted-foreground">(selected by default)</span> : null}
        </div>
        {tier.subtitle || tier.label ? <div className="text-xs text-muted-foreground">{[tier.subtitle, tier.label].filter(Boolean).join(" · ")}</div> : null}
      </TableCell>
      <TableCell className="align-top tabular-nums">{tier.quantity ?? "—"}</TableCell>
      <TableCell className="align-top whitespace-normal">
        {dealText(tier.deal, currency)}
        {tier.percentOff !== undefined && tier.deal.kind !== "percent" ? (
          <div className="text-[11px] text-muted-foreground" title="Our arithmetic: the tier's price vs. that many units at the single price">
            ≈ {Math.round(tier.percentOff)}% off by our math
          </div>
        ) : null}
      </TableCell>
      <TableCell className="align-top whitespace-normal text-xs">
        <div className="flex flex-col gap-0.5">
          {tier.freeShipping ? (
            <span className="inline-flex items-center gap-1">
              <Truck className="w-3 h-3" />
              Free shipping
            </span>
          ) : null}
          {tier.freeGifts.map((g) => (
            <span key={g} className="inline-flex items-center gap-1">
              <Gift className="w-3 h-3 shrink-0" />
              {g}
            </span>
          ))}
          {!tier.freeShipping && !tier.freeGifts.length ? <span className="text-muted-foreground">—</span> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function StoreTeardown({ teardown: t, host }: { teardown: Teardown; host: string }) {
  const currency = t.price?.currency;
  const sections = groupSections(t.sections);
  return (
    <section className="border-t border-border pt-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <ScanSearch className="w-4 h-4 text-primary" />
          Product page teardown
        </h4>
        <a
          href={`https://${host}${t.productPath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1 min-w-0 max-w-full"
        >
          <span className="truncate">{t.productTitle ?? t.productPath}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Heading icon={Tag}>Price</Heading>
          {t.price ? (
            <p className="text-sm">
              Page shows <span className="font-semibold">{money(t.price.price, currency)}</span>
              {t.price.compareAt ? (
                <>
                  {" "}
                  vs. compare-at <span className="line-through text-muted-foreground">{money(t.price.compareAt, currency)}</span>{" "}
                  <Badge variant="outline">{t.price.percentOff}% off</Badge>
                </>
              ) : (
                " with no compare-at price"
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Couldn't read the price.</p>
          )}
        </div>
        <div>
          <Heading icon={Star}>Reviews</Heading>
          {t.reviews ? (
            <p className="text-sm">
              Page shows{" "}
              {t.reviews.rating !== undefined ? <span className="font-semibold">{t.reviews.rating.toLocaleString(undefined, { maximumFractionDigits: 2 })} ★</span> : null}
              {t.reviews.rating !== undefined && t.reviews.count !== undefined ? " from " : null}
              {t.reviews.count !== undefined ? <span className="font-semibold">{t.reviews.count.toLocaleString()} reviews</span> : null}
              <span className="block text-xs text-muted-foreground">
                {t.reviews.app ? `${t.reviews.app} widget` : `From the page's ${t.reviews.source}`} · the store's own numbers, not verified
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No rating in the page's HTML. Some review widgets only load in the browser.</p>
          )}
        </div>
      </div>

      <div>
        <Heading icon={Package}>Bundle offer</Heading>
        {t.bundle ? (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {t.bundle.tiers.length} tiers from {t.bundle.app}
              {t.bundle.heading ? ` under “${t.bundle.heading}”` : ""}, as set up on the page
            </p>
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    <TableHead>Units</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Perks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.bundle.tiers.map((tier, i) => (
                    <TierRow key={`${tier.title}-${i}`} tier={tier} currency={currency} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No bundle tiers found. We read Kaching Bundles, Upsell Koala, Vitals volume discounts and Debutify quantity breaks; other bundle apps and custom pickers that load in the browser don't show here.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <Heading icon={ListChecks}>Conversion features on the page ({t.features.length})</Heading>
          {t.features.length ? (
            <ul className="space-y-1.5">
              {t.features.map((f) => (
                <li key={f.key} className="text-sm flex items-start gap-1.5 min-w-0">
                  <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {f.label}
                    {f.evidence ? <div className="text-[11px] text-muted-foreground line-clamp-1 break-all">“{f.evidence}”</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None found in the page's HTML.</p>
          )}
        </div>
        <div>
          <Heading icon={LayoutList}>Page layout, top to bottom</Heading>
          {sections.length > 1 ? (
            <ol className="text-sm space-y-0.5 list-decimal list-inside marker:text-muted-foreground">
              {sections.map((s, i) => (
                <li key={`${s.label}-${i}`}>
                  {s.label}
                  {s.count > 1 ? <span className="text-muted-foreground"> ×{s.count}</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">The page's sections couldn't be read (page builders often hide them).</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">From the theme's section names; header and footer left out.</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Everything here is what the page shows from its HTML and product data, without a browser. Ratings, counts and urgency are the store's claims, not checked by us.
      </p>
    </section>
  );
}
