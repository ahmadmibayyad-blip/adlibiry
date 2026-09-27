import { useState } from "react";
import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import { LineChart, Compass, Search, Filter, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import TrendCard, { TrendCardSkeleton } from "./_components/TrendCard.tsx";
import NicheCard from "./_components/NicheCard.tsx";
import SupplierCard, { SupplierCardSkeleton } from "./_components/SupplierCard.tsx";
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
  const seedResearchData = useMutation(api.trends.seedResearchData);

  const handleSeed = async () => {
    await seedResearchData();
    toast.success("Research data loaded!");
  };

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
        {trends !== undefined && trends.length === 0 && (
          <Button size="sm" variant="outline" onClick={handleSeed} className="text-xs">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Load Sample Research Data
          </Button>
        )}
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
          <h3 className="font-semibold mb-1">No trend data yet</h3>
          <p className="text-sm text-muted-foreground">Click "Load Sample Research Data" above to populate trends.</p>
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
        <p className="text-sm text-muted-foreground">Load sample research data from the Trends tab first.</p>
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

function SourcingTab({ initialNiche }: { initialNiche?: string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [niche, setNiche] = useState<string | undefined>(initialNiche);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const allNiches = useQuery(api.trends.listNiches, {});

  const { results, status, loadMore } = usePaginatedQuery(
    api.trends.searchSuppliers,
    { search: debouncedSearch || undefined, niche },
    { initialNumItems: 12 }
  );

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search AliExpress-style suppliers by product name..."
          className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
        />
      </div>

      {allNiches && allNiches.length > 0 && (
        <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
          <button
            onClick={() => setNiche(undefined)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
              !niche
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All niches
          </button>
          {allNiches.map((n) => (
            <button
              key={n._id}
              onClick={() => setNiche(n.name)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border",
                niche === n.name
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {n.name}
            </button>
          ))}
        </div>
      )}

      {status === "LoadingFirstPage" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <SupplierCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center border border-dashed border-border rounded-xl">
          <Search className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">No suppliers found</h3>
          <p className="text-sm text-muted-foreground">Try a different search term, or load sample data from the Trends tab.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((supplier, i) => (
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
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-8">
              <Button variant="outline" onClick={() => loadMore(12)} className="px-8">
                Load more suppliers
              </Button>
            </div>
          )}
        </>
      )}

      <SupplierDetailModal supplier={selectedSupplier} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
