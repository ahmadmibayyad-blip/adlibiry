import { motion } from "motion/react";

const stats = [
  { value: "10M+", label: "Ads Tracked" },
  { value: "2.4M+", label: "Products Indexed" },
  { value: "500K+", label: "Stores Monitored" },
  { value: "50K+", label: "Active Users" },
  { value: "180+", label: "Countries Covered" },
];

export default function StatsBar() {
  return (
    <section className="py-12 border-y border-border bg-card/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              className="text-center"
            >
              <div className="text-3xl font-extrabold text-primary mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
