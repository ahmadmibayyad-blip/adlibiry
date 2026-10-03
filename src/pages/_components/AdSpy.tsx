import { motion } from "motion/react";
import { TrendingUp, DollarSign, Heart, Eye, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";

const mockAds = [
  {
    id: 1,
    brand: "FitLife Pro",
    platform: "Facebook",
    image: "https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400&q=80",
    score: 94,
    spend: "$42K",
    likes: "18.4K",
    views: "2.1M",
    country: "US",
    niche: "Health & Fitness",
    days: 34,
  },
  {
    id: 2,
    brand: "HomeStyle Co.",
    platform: "TikTok",
    image: "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400&q=80",
    score: 89,
    spend: "$28K",
    likes: "31.2K",
    views: "4.8M",
    country: "UK",
    niche: "Home Decor",
    days: 21,
  },
  {
    id: 3,
    brand: "TechGadgets",
    platform: "Facebook",
    image: "https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400&q=80",
    score: 97,
    spend: "$85K",
    likes: "9.7K",
    views: "890K",
    country: "US",
    niche: "Electronics",
    days: 58,
  },
];

function ScoreRing({ score }: { score: number }) {
  const color = score >= 90 ? "text-good" : score >= 75 ? "text-warn" : "text-bad";
  return (
    <div className={`text-xs font-bold ${color} bg-background/60 rounded-lg px-2 py-1 border border-border`}>
      AI {score}
    </div>
  );
}

export default function AdSpy() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[100px]" />
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-5">
            Live Ad Intelligence
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Spy on Any Ad.
            <span className="text-primary"> Anywhere.</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Real-time access to millions of ads across Facebook, TikTok, and Pinterest — with spend data, AI scoring, and full creative breakdowns.
          </p>
        </motion.div>

        {/* Mock ad cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
          {mockAds.map((ad, i) => (
            <motion.div
              key={ad.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="bg-card border border-border rounded-2xl overflow-hidden group hover:border-primary/30 transition-all duration-300 cursor-pointer"
            >
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                <img
                  src={ad.image}
                  alt={ad.brand}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 left-3 flex gap-2">
                  <ScoreRing score={ad.score} />
                </div>
                <div className="absolute top-3 right-3">
                  <Badge variant="secondary" className="text-xs font-medium bg-background/80 backdrop-blur-sm">
                    <Globe className="w-3 h-3 mr-1" />
                    {ad.platform}
                  </Badge>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card to-transparent" />
              </div>

              {/* Content */}
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-sm">{ad.brand}</h3>
                    <span className="text-xs text-muted-foreground">{ad.niche}</span>
                  </div>
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                    {ad.country}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center bg-muted/50 rounded-lg py-2">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                      <DollarSign className="w-3 h-3" />
                      Spend
                    </div>
                    <div className="font-bold text-sm text-primary">{ad.spend}</div>
                  </div>
                  <div className="text-center bg-muted/50 rounded-lg py-2">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                      <Heart className="w-3 h-3" />
                      Likes
                    </div>
                    <div className="font-bold text-sm">{ad.likes}</div>
                  </div>
                  <div className="text-center bg-muted/50 rounded-lg py-2">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                      <Eye className="w-3 h-3" />
                      Views
                    </div>
                    <div className="font-bold text-sm">{ad.views}</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-good" />
                    Running {ad.days} days
                  </span>
                  <span className="text-primary font-medium cursor-pointer hover:underline">View Ad →</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <p className="text-muted-foreground text-sm mb-4">
            Showing 3 of 10,000,000+ ads. Start your free trial to unlock everything.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
