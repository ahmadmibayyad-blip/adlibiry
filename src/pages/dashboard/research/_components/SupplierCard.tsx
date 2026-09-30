import { Star, Truck, Package, Users, ExternalLink } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { cn } from "@/lib/utils.ts";
import { supplierLink } from "@/lib/supplierLink.ts";

type Supplier = Doc<"supplierListings">;

function saturationFromSellers(sellerCount: number): { label: string; color: string } {
  if (sellerCount <= 20) return { label: "Low", color: "text-green-400 bg-green-400/10" };
  if (sellerCount <= 60) return { label: "Medium", color: "text-yellow-400 bg-yellow-400/10" };
  return { label: "High", color: "text-red-400 bg-red-400/10" };
}

export default function SupplierCard({ supplier, onSelect }: { supplier: Supplier; onSelect: () => void }) {
  const saturation = saturationFromSellers(supplier.sellerCount);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-all">
      <div className="aspect-[4/3] bg-muted overflow-hidden">
        <img src={supplier.imageUrl} alt={supplier.title} className="w-full h-full object-cover" />
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 mb-2">{supplier.title}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
            {supplier.rating} ({supplier.reviewCount.toLocaleString()})
          </div>
          <div className="flex items-center gap-1">
            <Truck className="w-3.5 h-3.5" />
            {supplier.shippingDays}d
          </div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-bold">${supplier.price.toFixed(2)}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Package className="w-3.5 h-3.5" />
            {supplier.orders.toLocaleString()} orders
          </div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1", saturation.color)}>
            <Users className="w-3 h-3" />
            {saturation.label} saturation
          </span>
          <span className="text-[11px] text-muted-foreground">{supplier.sellerCount} sellers</span>
        </div>
        <button
          onClick={onSelect}
          className="w-full text-xs font-medium bg-secondary hover:bg-secondary/80 rounded-lg py-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
        >
          Calculate profit
        </button>
        <a
          href={supplierLink(supplier)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 w-full text-xs font-medium text-primary hover:underline rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {supplier.storeName}
        </a>
      </div>
    </div>
  );
}

export function SupplierCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="flex justify-between">
          <div className="h-5 bg-muted rounded w-16" />
          <div className="h-3 bg-muted rounded w-20" />
        </div>
      </div>
    </div>
  );
}
