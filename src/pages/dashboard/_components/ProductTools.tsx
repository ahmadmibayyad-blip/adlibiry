import { ExternalLink, Package } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import ProfitCalculator from "./ProfitCalculator.tsx";
import ResearchVerdictCard from "./ai/ResearchVerdictCard.tsx";
import AIAdAnglesCard from "./ai/AIAdAnglesCard.tsx";
import AICompetitorFinderCard from "./ai/AICompetitorFinderCard.tsx";
import CountrySaturationCard from "./ai/CountrySaturationCard.tsx";
import SuppliersSection from "../products/_components/SuppliersSection.tsx";

// The product page's tools (profit calculator, suppliers, AI tools), shared with
// the ad page. Without a product (an ad not linked to one yet), the tools that
// need one are replaced by what can still be done from the ad's text.

type Subject = { title: string; description: string; category: string };

/** The AI tools, two per row. The research verdict needs a product. */
export function AIToolsGrid({ product, subject }: { product?: Doc<"products">; subject: Subject }) {
  return (
    <div>
      <h3 className="font-display text-lg font-bold mb-4">AI tools</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {product && (
          <ResearchVerdictCard
            productId={product._id}
            hasSuppliers={(product.supplierMatches?.length ?? 0) + (product.wholesaleMatches?.length ?? 0) > 0}
          />
        )}
        <AIAdAnglesCard title={subject.title} description={subject.description} category={subject.category} />
        <div id="competitors" className="scroll-mt-20">
          <AICompetitorFinderCard productTitle={subject.title} category={subject.category} />
        </div>
        <CountrySaturationCard productTitle={subject.title} niche={subject.category} />
      </div>
    </div>
  );
}

/** Profit calculator and suppliers side by side, then the AI tools: for a page that isn't the product page. */
export default function ProductTools({ product, subject }: { product?: Doc<"products">; subject: Subject }) {
  const search = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(subject.title.slice(0, 80))}`;
  return (
    <section className="mt-8 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div id="profit-calculator" className="scroll-mt-20">
          {/* Keyed so the calculator starts from the product's numbers once they load. */}
          <ProfitCalculator key={product?._id ?? "none"} basePrice={product?.price ?? 0} baseCost={product?.cost ?? 0} />
        </div>
        {product ? (
          <div id="suppliers" className="scroll-mt-20 empty:hidden">
            <SuppliersSection product={product} />
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" /> Suppliers
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              This ad isn't linked to a product yet, so we haven't matched suppliers for it. Search AliExpress for what it sells.
            </p>
            <a
              href={search}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:bg-muted"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Search AliExpress
            </a>
          </div>
        )}
      </div>
      <AIToolsGrid product={product} subject={subject} />
    </section>
  );
}
