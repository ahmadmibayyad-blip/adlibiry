import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Star, Truck, Package, Users, ExternalLink } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import ProfitCalculator from "../../_components/ProfitCalculator.tsx";

type Supplier = Doc<"supplierListings">;

export default function SupplierDetailModal({ supplier, open, onOpenChange }: { supplier: Supplier | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!supplier) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{supplier.title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="rounded-xl overflow-hidden border border-border bg-muted mb-3">
              <img src={supplier.imageUrl} alt={supplier.title} className="w-full aspect-[4/3] object-cover" />
            </div>
            <h2 className="text-base font-bold leading-tight mb-2">{supplier.title}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                {supplier.rating} ({supplier.reviewCount.toLocaleString()} reviews)
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div className="bg-muted rounded-lg p-2.5 flex items-center gap-2">
                <Truck className="w-4 h-4 text-muted-foreground" />
                <span>{supplier.shippingDays} day shipping</span>
              </div>
              <div className="bg-muted rounded-lg p-2.5 flex items-center gap-2">
                <Package className="w-4 h-4 text-muted-foreground" />
                <span>{supplier.orders.toLocaleString()} orders</span>
              </div>
              <div className="bg-muted rounded-lg p-2.5 flex items-center gap-2 col-span-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span>{supplier.sellerCount} sellers offering this product</span>
              </div>
            </div>
            <a
              href={supplier.supplierUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-sm font-medium bg-secondary hover:bg-secondary/80 rounded-lg py-2.5 transition-colors flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="w-4 h-4" />
              View {supplier.storeName} ({supplier.storeRating}★)
            </a>
          </div>

          <ProfitCalculator basePrice={Math.round(supplier.price * 4)} baseCost={supplier.price} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
