import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { motion } from "motion/react";
import {
  TrendingUp, Bookmark, Zap, Trophy, ArrowRight, Package, Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import ProductCard, { ProductCardSkeleton } from "./_components/ProductCard.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { toast } from "sonner";

const statItems = [
  { icon: Package, label: "Products Tracked", color: "text-blue-400", key: "totalProducts" as const },
  { icon: Trophy, label: "Winners Today", color: "text-yellow-400", key: "winnersToday" as const },
  { icon: TrendingUp, label: "New This Week", color: "text-green-400", key: "newThisWeek" as const },
  { icon: Bookmark, label: "Saved by You", color: "text-purple-400", key: "savedCount" as const },
];

export default function DashboardHome() {
  const { user } = useAuth();
  const stats = useQuery(api.products.getDashboardStats, {});
  const winners = useQuery(api.products.getWinnersOfDay, {});
  const seedProducts = useMutation(api.products.seedProducts);
  const isAdmin = useQuery(api.users.isAdmin, {});

  const handleSeed = async () => {
    await seedProducts();
    toast.success("Products seeded!");
  };

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1">
              {greeting()}, {user?.profile?.name?.split(" ")[0] ?? "there"} 👋
            </h1>
            <p className="text-muted-foreground text-sm">
              Here's what's winning today — refreshed daily from live ad and marketplace data.
            </p>
          </div>
          {/* Dev seed button — admins only, only visible when no products */}
          {isAdmin && winners !== undefined && winners.length === 0 && (
            <Button size="sm" variant="outline" onClick={handleSeed} className="text-xs">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Load Sample Products
            </Button>
          )}
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        {statItems.map((item) => (
          <div key={item.key} className="bg-card border border-border rounded-xl p-4">
            <div className={`${item.color} mb-2`}>
              <item.icon className="w-5 h-5" />
            </div>
            {stats === undefined ? (
              <Skeleton className="h-7 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{stats[item.key]}</div>
            )}
            <div className="text-xs text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Today's Winners */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <h2 className="text-lg font-bold">Today's Winning Products</h2>
            <div className="flex items-center gap-1 bg-green-400/10 text-green-400 text-xs px-2 py-0.5 rounded-full border border-green-400/20">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Live
            </div>
          </div>
          <Link
            to="/dashboard/products"
            className="flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {winners === undefined ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : winners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Zap className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No products yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Load Sample Products" above to populate the feed.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {winners.map((product) => (
              <motion.div
                key={product._id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
