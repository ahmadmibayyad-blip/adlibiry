import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { BellRing, X } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import ProductImage from "@/components/ProductImage.tsx";

// Alerts page: products I follow (Pro), with the score I'm waiting for.
export default function FollowedProductsPanel() {
  const rows = useQuery(api.follows.listFollowedProducts, {});
  const unfollow = useMutation(api.follows.unfollowProduct);
  if (!rows?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Products you follow</h3>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r._id} className="flex items-center gap-3 py-2">
            <ProductImage src={r.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
            <Link to={`/dashboard/products/${r.productId}`} className="min-w-0 flex-1 hover:underline">
              <div className="text-sm font-medium truncate">{r.title}</div>
              <div className="text-xs text-muted-foreground">
                Score {r.aiScore} · {r.linkedAds} ad{r.linkedAds === 1 ? "" : "s"}
                {r.minScore !== null && ` · alert at ${r.minScore}`}
              </div>
            </Link>
            <button type="button" aria-label="Unfollow" onClick={() => unfollow({ productId: r.productId })} className="text-muted-foreground hover:text-foreground cursor-pointer p-1">
              <X className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
