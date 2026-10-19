import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { Heart, Play, ShoppingBag, Star, Store, TrendingUp } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { amazonMarket, uniqueShopItems, type AmazonItem, type MarketEntry, type ProductMarkets } from "@/convex/lib/justone.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { price } from "@/lib/money.ts";
import { Spinner } from "@/components/ui/spinner.tsx";

// Product page → AliExpress best sellers, On Amazon, Viral on TikTok and On TikTok Shop (convex/justone.ts, JustOne API):
// looked up when the page opens (each again after a week) and saved on the product for everyone.

const age = (iso: string | undefined) => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days < 1 ? "today" : `${days}d ago`; // short: it sits under a narrow TikTok tile
};

function Card({ icon, title, sub, children }: { icon: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm flex items-center gap-1.5">
        {icon} {title}
      </h3>
      {sub ? <p className="text-xs text-muted-foreground mt-0.5 mb-2">{sub}</p> : <div className="mb-2" />}
      {children}
    </div>
  );
}

function Searching({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <Spinner className="w-3.5 h-3.5" /> {what}
    </p>
  );
}

function Row({ href, image, title, children }: { href: string; image?: string; title: string; children: ReactNode }) {
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex gap-3 group rounded-md -mx-1 px-1 py-1 hover:bg-muted/50 min-h-10">
        {image ? (
          <img src={image} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-12 h-12 rounded object-cover shrink-0 bg-muted" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        ) : (
          <span className="w-12 h-12 rounded bg-muted shrink-0" />
        )}
        <span className="min-w-0 text-xs">
          <span className="block text-sm line-clamp-2 group-hover:underline">{title}</span>
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">{children}</span>
        </span>
      </a>
    </li>
  );
}

const stars = (rating?: number, count?: number) =>
  rating ? (
    <span className="inline-flex items-center gap-0.5">
      <Star className="w-3 h-3 fill-current text-yellow-500" aria-hidden />
      {rating.toFixed(1)}
      {count ? ` (${compactNumber(count)})` : ""}
    </span>
  ) : null;

const isEmpty = (e: MarketEntry<unknown> | undefined) => !e || (!e.items.length && e.failed);

export default function MarketsSection({ product }: { product: Doc<"products"> }) {
  const { isAuthenticated } = useConvexAuth();
  const lookUp = useAction(api.justone.marketsFor);
  const mine = useQuery(api.onboarding.mine, isAuthenticated ? {} : "skip");
  const started = useRef<string | null>(null);
  const [searching, setSearching] = useState(false);
  const markets = (product.markets ?? {}) as ProductMarkets;
  const amazonCountry = amazonMarket(mine?.targetCountry);

  useEffect(() => {
    if (!isAuthenticated || product.isService || mine === undefined || started.current === product._id) return;
    started.current = product._id;
    setSearching(true);
    lookUp({ productId: product._id })
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [isAuthenticated, product._id, product.isService, mine, lookUp]);

  if (product.isService) return null;
  const ali = markets.aliexpress;
  const amazon = markets.amazon?.[amazonCountry];
  const tiktok = markets.tiktok;
  const shop = markets.tiktokShop;
  // Nothing saved and nothing on the way (not set up, or today's cap reached): show nothing.
  if (!searching && isEmpty(ali) && isEmpty(amazon) && isEmpty(tiktok) && isEmpty(shop)) return null;

  return (
    <>
      {ali?.items.length ? (
        <Card icon={<TrendingUp className="w-4 h-4 text-primary" />} title="AliExpress best sellers" sub={`The listings with the most orders${ali.total ? ` out of ${compactNumber(ali.total)}` : ""}. Lots of orders means it sells, and that suppliers can deliver.`}>
          <ul className="space-y-1">
            {ali.items.slice(0, 5).map((it) => (
              <Row key={it.id} href={it.url} image={it.image} title={it.title}>
                {it.priceUsd ? <span className="font-medium text-foreground">{price(it.priceUsd)}</span> : null}
                {it.sold ? <span>{compactNumber(it.sold)} sold</span> : null}
                {stars(it.rating)}
              </Row>
            ))}
          </ul>
        </Card>
      ) : searching && !ali ? (
        <Card icon={<TrendingUp className="w-4 h-4 text-primary" />} title="AliExpress best sellers">
          <Searching what="Looking up AliExpress's best sellers…" />
        </Card>
      ) : null}

      <AmazonCard entry={amazon} country={amazonCountry} searching={searching} />

      {tiktok?.items.length ? (
        <Card icon={<Play className="w-4 h-4 text-primary" />} title="Viral on TikTok" sub="The most-liked videos about it from the last 30 days, ads and organic.">
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tiktok.items.slice(0, 4).map((vid) => (
              <li key={vid.id}>
                <a href={vid.url} target="_blank" rel="noopener noreferrer" className="block group" aria-label={`TikTok video${vid.author ? ` by @${vid.author}` : ""}`}>
                  <span className="block relative aspect-[3/4] rounded-md overflow-hidden bg-muted">
                    {vid.cover ? (
                      <img src={vid.cover} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                    ) : null}
                    {/* Views on the picture, likes and age underneath: two numbers don't fit a narrow tile. */}
                    {vid.plays ? (
                      <span className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent text-white text-xs font-medium inline-flex items-center gap-1">
                        <Play className="w-3 h-3 shrink-0" aria-hidden /> {compactNumber(vid.plays)}<span className="sr-only"> views</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs mt-1 truncate group-hover:underline">{vid.author ? `@${vid.author}` : "TikTok"}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                    <Heart className="w-3 h-3 shrink-0" aria-hidden /> {compactNumber(vid.likes ?? 0)}<span className="sr-only"> likes</span>
                    <span className="truncate">· {age(vid.createdAt)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : searching && !tiktok ? (
        <Card icon={<Play className="w-4 h-4 text-primary" />} title="Viral on TikTok">
          <Searching what="Looking for TikTok videos…" />
        </Card>
      ) : tiktok && !tiktok.failed ? (
        <Card icon={<Play className="w-4 h-4 text-primary" />} title="Viral on TikTok">
          <p className="text-xs text-muted-foreground">No TikTok videos about it in the last 30 days: either nobody is pushing it there yet, or it's not a TikTok product.</p>
        </Card>
      ) : null}

      {shop?.items.length ? (
        <Card icon={<ShoppingBag className="w-4 h-4 text-primary" />} title="On TikTok Shop (US)" sub="The same kind of product in TikTok's own shop, with what it has sold.">
          <ul className="space-y-1">
            {uniqueShopItems(shop.items).slice(0, 4).map((it) => (
              <Row key={it.id} href={it.url} image={it.image} title={it.title}>
                {it.price ? <span className="font-medium text-foreground">{it.currency === "USD" || !it.currency ? price(it.price) : `${it.currency} ${it.price.toFixed(2)}`}</span> : null}
                {it.sold ? <span>{compactNumber(it.sold)} sold</span> : null}
                {stars(it.rating, it.reviews)}
                {it.shop ? (
                  <span className="inline-flex items-center gap-0.5 min-w-0"><Store className="w-3 h-3 shrink-0" aria-hidden /> <span className="truncate">{it.shop}</span></span>
                ) : null}
              </Row>
            ))}
          </ul>
        </Card>
      ) : searching && !shop ? (
        <Card icon={<ShoppingBag className="w-4 h-4 text-primary" />} title="On TikTok Shop (US)">
          <Searching what="Searching TikTok Shop…" />
        </Card>
      ) : null}
    </>
  );
}

const AMAZON_DOMAIN: Record<string, string> = { US: "amazon.com", GB: "amazon.co.uk", DE: "amazon.de", FR: "amazon.fr", IT: "amazon.it", ES: "amazon.es", NL: "amazon.nl", SE: "amazon.se", PL: "amazon.pl", BE: "amazon.com.be", IE: "amazon.ie", CA: "amazon.ca", AU: "amazon.com.au", JP: "amazon.co.jp", MX: "amazon.com.mx", BR: "amazon.com.br", IN: "amazon.in", TR: "amazon.com.tr", AE: "amazon.ae", SA: "amazon.sa", SG: "amazon.sg", EG: "amazon.eg", ZA: "amazon.co.za" };

function AmazonCard({ entry, country, searching }: { entry: MarketEntry<AmazonItem> | undefined; country: string; searching: boolean }) {
  const domain = AMAZON_DOMAIN[country] ?? "Amazon";
  const icon = <ShoppingBag className="w-4 h-4 text-primary" />;
  if (!entry) return searching ? <Card icon={icon} title={`On ${domain}`}><Searching what={`Searching ${domain}…`} /></Card> : null;
  if (!entry.items.length) {
    return entry.failed ? null : (
      <Card icon={icon} title={`On ${domain}`}>
        <p className="text-xs text-muted-foreground">Not sold on {domain} yet: less competition from Amazon's fast delivery.</p>
      </Card>
    );
  }
  const selling = entry.items.filter((it) => (it.boughtLastMonth ?? 0) >= 100).length;
  return (
    <Card
      icon={icon}
      title={`On ${domain}`}
      sub={`${entry.total ? `${compactNumber(entry.total)} results. ` : ""}${selling ? `${selling} of the top ${Math.min(entry.items.length, 8)} sold 100+ last month: people buy it there, and Amazon delivers fast.` : "None of the top results shows 100+ sold last month."}`}
    >
      <ul className="space-y-1">
        {entry.items.slice(0, 4).map((it) => (
          <Row key={it.asin} href={it.url} image={it.image} title={it.title}>
            {it.priceText ? <span className="font-medium text-foreground">{it.priceText}</span> : null}
            {it.boughtLastMonth ? <span className="text-good font-medium">{compactNumber(it.boughtLastMonth)}+ last month</span> : null}
            {stars(it.stars, it.ratings)}
            {it.bestSeller ? <span className="text-primary">Best seller</span> : it.amazonChoice ? <span className="text-primary">Amazon's choice</span> : null}
          </Row>
        ))}
      </ul>
    </Card>
  );
}
