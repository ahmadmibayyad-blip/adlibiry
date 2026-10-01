import { useState } from "react";
import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { LineChart, Compass, Search, Filter, Sparkles, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import TrendCard, { TrendCardSkeleton } from "./_components/TrendCard.tsx";
import NicheCard from "./_components/NicheCard.tsx";
import SupplierCard from "./_components/SupplierCard.tsx";
import ProductCard, { ProductCardSkeleton } from "../_components/ProductCard.tsx";
import { NICHES } from "@/convex/lib/category.ts";
import SupplierDetailModal from "./_components/SupplierDetailModal.tsx";
import AINicheReportModal from "../_components/ai/AINicheReportModal.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { toast } from "sonner";

type Supplier = Doc<"supplierListings">;
type Niche = Doc<"niches">;
type Tab = "trends" | "niches" | "sourcing";

const directions = ["All", "Rising", "Stable", "Declining"];

export default function ResearchPage() {
  const [tab, setTab] = useState<Tab>("trends");
  const [nicheFilter, setNicheFilter] = useState<string | undefined>(undefined);

  const tabs: { id: Tab; label: string; icon: typeof LineChart }[] = [
    { id: "trends", label: "Trends", icon: LineChart },
    { id: "niches", label: "Niche Explorer", icon: Compass },
    { id: "sourcing", label: "Sourcing", icon: Search },
  ];

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <LineChart className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Product Research</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Trending keywords, niche breakdowns, and supplier sourcing — everything to validate a product before you spend on ads.
        </p>
      </motion.div>

      <div className="flex items-center gap-2 mb-6 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px whitespace-nowrap",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trends" && <TrendsTab />}
      {tab === "niches" && <NichesTab onSelectNiche={(niche) => { setNicheFilter(niche); setTab("sourcing"); }} />}
      {tab === "sourcing" && <SourcingTab initialNiche={nicheFilter} />}
    </div>
  );
}

function TrendsTab() {
  const [direction, setDirection] = useState<string | undefined>(undefined);
  const trends = useQuery(api.trends.list, { direction });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {directions.map((d) => {
            const isActive = d === "All" ? !direction : direction === d;
            return (
              <button
                key={d}
                onClick={() => setDirection(d === "All" ? undefined : d)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Product words and phrases counted in new ads each week. Rising = more new ads this week than last. Updated every morning.
        </p>
      </div>

      {trends === undefined ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <TrendCardSkeleton key={i} />
          ))}
        </div>
      ) : trends.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <LineChart className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No trends yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Trends are built every morning from new ads. They appear once enough ads mention the same product
            (3+ in the last two weeks).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {trends.map((trend, i) => (
            <motion.div
              key={trend._id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: (i % 6) * 0.05 }}
            >
              <TrendCard trend={trend} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function NichesTab({ onSelectNiche }: { onSelectNiche: (niche: string) => void }) {
  const niches = useQuery(api.trends.listNiches, {});
  const [reportNiche, setReportNiche] = useState<Niche | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  if (niches === undefined) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 h-40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (niches.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
        <Compass className="w-10 h-10 text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">No niches yet</h3>
        <p className="text-sm text-muted-foreground">Niche stats are built every morning from your products and ads.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {niches.map((niche, i) => (
          <motion.div
            key={niche._id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: (i % 6) * 0.05 }}
          >
            <NicheCard
              niche={niche}
              onClick={() => onSelectNiche(niche.name)}
              onGenerateReport={() => {
                setReportNiche(niche);
                setReportOpen(true);
              }}
            />
          </motion.div>
        ))}
      </div>
      <AINicheReportModal niche={reportNiche} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}

// Where to look for a supplier: searches on the big wholesale / dropshipping
// marketplaces for the typed product (CJ has no stable search URL, so it's a
// site search).
const SUPPLIER_SITES: { name: string; note: string; url: (q: string) => string }[] = [
  { name: "AliExpress", note: "Dropshipping, small orders", url: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}` },
  { name: "Alibaba", note: "Factories, bulk pricing", url: (q) => `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(q)}` },
  { name: "CJdropshipping", note: "Fulfilment & EU/US warehouses", url: (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:cjdropshipping.com ${q}`)}` },
  { name: "Temu", note: "Check retail price floor", url: (q) => `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(q)}` },
  { name: "Amazon", note: "Competing listings & reviews", url: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
];

function SourcingTab({ initialNiche }: { initialNiche?: string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [niche, setNiche] = useState<string | undefined>(initialNiche);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const researchNiches = useQuery(api.trends.listNiches, {});
  const nicheNames = researchNiches?.length ? researchNiches.map((n) => n.name) : NICHES.filter((n) => n !== "Other");
  const term = debouncedSearch.trim();

  const suppliers = usePaginatedQuery(
    api.trends.searchSuppliers,
    { search: term || undefined, niche },
    { initialNumItems: 12 }
  );
  const products = usePaginatedQuery(
    api.products.list,
    term || niche ? { search: term || undefined, categories: niche ? [niche] : undefined, sort: "score" } : "skip",
    { initialNumItems: 8 }
  );
  const lookFor = term || niche;

  return (
    <div className="space-y-6">
      <div>
        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Product to source, e.g. dog cooling mat"
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setNiche(undefined)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
              !niche ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All niches
          </button>
          {nicheNames.map((n) => (
            <button
              key={n}
              onClick={() => setNiche(niche === n ? undefined : n)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                niche === n ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {!lookFor ? (
        <div className="flex flex-col items-center py-14 text-center border border-dashed border-border rounded-xl px-6">
          <Search className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">What do you want to source?</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Type a product or pick a niche. You'll get supplier searches on AliExpress, Alibaba, CJdropshipping, Temu and Amazon,
            plus matching products already in AdSpy Pro.
          </p>
        </div>
      ) : (
        <>
          <section>
            <h3 className="text-sm font-semibold mb-2">Find suppliers for “{lookFor}”</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {SUPPLIER_SITES.map((site) => (
                <a
                  key={site.name}
                  href={site.url(lookFor)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2.5 hover:border-primary/50 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{site.name}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{site.note}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Matching products in AdSpy Pro</h3>
            {products.status === "LoadingFirstPage" ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
                {Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : products.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products in AdSpy Pro match yet — use the supplier searches above.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
                  {products.results.map((p) => <ProductCard key={p._id} product={p} />)}
                </div>
                {products.status === "CanLoadMore" && (
                  <div className="flex justify-center mt-6">
                    <Button variant="outline" onClick={() => products.loadMore(8)}>Load more products</Button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {suppliers.results.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Saved supplier listings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {suppliers.results.map((supplier, i) => (
              <motion.div
                key={supplier._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: (i % 8) * 0.04 }}
              >
                <SupplierCard
                  supplier={supplier}
                  onSelect={() => {
                    setSelectedSupplier(supplier);
                    setModalOpen(true);
                  }}
                />
              </motion.div>
            ))}
          </div>
          {suppliers.status === "CanLoadMore" && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={() => suppliers.loadMore(12)}>Load more suppliers</Button>
            </div>
          )}
        </section>
      )}

      <SupplierDetailModal supplier={selectedSupplier} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
