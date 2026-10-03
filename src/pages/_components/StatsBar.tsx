import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

// Live counts from the database, so the numbers are true and grow on their own.
export default function StatsBar() {
  const stats = useQuery(api.stats.get, {});
  const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString("en-US"));
  const items = [
    { value: n(stats?.ads.total), label: "Ads tracked" },
    { value: n(stats?.ads.activeCount), label: "Ads running now" },
    { value: n(stats?.products.total), label: "Products scored" },
    { value: n(stats?.ads.countries.length), label: "Countries" },
    { value: n(stats?.products.categories.length), label: "Niches" },
  ];

  return (
    <section className="py-10 border-y border-border bg-card/40" aria-label="AdSpy Pro in numbers">
      <dl className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="font-display text-3xl font-bold tabular-nums mt-1">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
