import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, CircleAlert, PlayCircle, PiggyBank, Bookmark, Zap } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import ProductImage from "@/components/ProductImage.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { cn } from "@/lib/utils.ts";
import { price } from "@/lib/money.ts";
import { shortTitle, simpleVerdict } from "@/lib/simpleVerdict.ts";

// Simple view home: one of today's winning products at a time, in plain words,
// and three big ways into the rest of the app.

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function SimpleHome() {
  const { user } = useAuth();
  const top = useQuery(api.products.getWinnersOfDay, {});
  const saved = useQuery(api.products.getSaved, {});
  const toggleSave = useMutation(api.products.toggleSave);
  const [index, setIndex] = useState(0);

  const product = top && top.length ? top[index % top.length] : undefined;
  const isSaved = !!product && !!saved?.some((p) => p?._id === product._id);
  const verdict = product ? simpleVerdict(product, price) : undefined;

  const onSave = async () => {
    if (!product) return;
    try {
      const r = await toggleSave({ productId: product._id });
      toast.success(r.saved ? "Saved. Find it under Saved products." : "Removed from saved");
    } catch {
      toast.error("Couldn't save it. Try again.");
    }
  };

  const ways = [
    { to: "/dashboard/ad-spy", icon: PlayCircle, title: "See ads that are working", text: "Videos other shops pay to show" },
    { to: "/dashboard/profit", icon: PiggyBank, title: "Check how my store is doing", text: "Orders and profit in one place" },
    { to: "/dashboard/saved", icon: Bookmark, title: "My saved products", text: saved === undefined ? "Your list" : `${saved.length} saved so far` },
  ];

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-12 max-w-5xl mx-auto space-y-10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-lg text-muted-foreground mb-2">
            {greeting()}, {user?.profile?.name?.split(" ")[0] ?? "there"}
          </p>
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-[18ch] leading-tight">
            Here is one product worth a look today.
          </h1>
        </div>
      </div>

      {top === undefined ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !product || !verdict ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card p-10">
          <Zap className="w-10 h-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">No product picked yet today</h2>
          <p className="text-muted-foreground mb-4">Today's pick shows here after the daily update. Meanwhile, browse what's selling.</p>
          <Link to="/dashboard/winners" className="inline-flex items-center h-12 px-6 rounded-xl bg-primary text-primary-foreground font-semibold">
            See winning products
          </Link>
        </div>
      ) : (
        <section aria-label="Today's product" className="flex flex-col md:flex-row gap-6 md:gap-8 rounded-2xl border border-border bg-card p-5 sm:p-7">
          <ProductImage
            src={product.imageUrl}
            alt={product.title}
            loading="eager"
            className="w-full md:w-96 aspect-square shrink-0 rounded-xl object-cover bg-muted"
          />
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            <div className="flex flex-col items-start gap-2.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold",
                  verdict.good ? "bg-primary/10 text-primary" : "bg-warn/10 text-warn",
                )}
              >
                {verdict.good ? <Check className="w-4 h-4" /> : <CircleAlert className="w-4 h-4" />}
                {verdict.label}
              </span>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-snug" title={product.title}>{shortTitle(product.title)}</h2>
              <p className="text-muted-foreground">
                {product.category}
                {top.length > 1 && ` · ${(index % top.length) + 1} of ${top.length} today`}
              </p>
            </div>

            {verdict.reasons.length > 0 && (
              <ul className="space-y-4 text-lg sm:text-xl leading-snug">
                {verdict.reasons.map((r) => (
                  <li key={r.text} className="flex gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
                        r.ok ? "bg-primary/10 text-primary" : "bg-warn/10 text-warn",
                      )}
                    >
                      {r.ok ? <Check className="w-4 h-4" /> : <CircleAlert className="w-4 h-4" />}
                    </span>
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-3 mt-auto pt-1">
              <Link
                to={`/dashboard/products/${product._id}`}
                className="inline-flex items-center h-14 px-7 rounded-xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90"
              >
                See the ads and details
              </Link>
              <button
                type="button"
                onClick={onSave}
                aria-pressed={isSaved}
                className="inline-flex items-center h-14 px-6 rounded-xl border border-border bg-card text-lg font-medium hover:bg-secondary cursor-pointer"
              >
                {isSaved ? "Saved" : "Save for later"}
              </button>
              {top.length > 1 && (
                <button
                  type="button"
                  onClick={() => setIndex((i) => i + 1)}
                  className="inline-flex items-center h-14 px-5 rounded-xl text-lg font-medium text-primary hover:bg-primary/5 cursor-pointer"
                >
                  Show me another
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <nav aria-label="More" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ways.map((w) => (
          <Link
            key={w.to}
            to={w.to}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-secondary transition-colors"
          >
            <span aria-hidden className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <w.icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-lg font-semibold">{w.title}</span>
              <span className="block text-muted-foreground">{w.text}</span>
            </span>
            <ChevronRight aria-hidden className="w-5 h-5 text-muted-foreground shrink-0" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
