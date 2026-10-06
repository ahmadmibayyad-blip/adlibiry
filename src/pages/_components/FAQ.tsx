import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Is there a free plan?",
    a: "Yes. The Free plan shows the first 10 results of every list, with no card needed. Pro unlocks every result for €35 a month, or €30 a month paid yearly (€360), and you can try it free for 7 days without a card.",
  },
  {
    q: "How accurate is the ad spend data?",
    a: "Spend estimates blend platform-reported figures with our own modelled ranges (CPM, engagement and funnel benchmarks), and every estimate is labelled with its basis. Treat them as directional — for ranking and comparing products, not as exact accounts.",
  },
  {
    q: "How often is the ad database updated?",
    a: "Imports run daily: new ads are synced every morning, product pricing is backfilled shortly after, and the winning-products list is rebuilt from scratch each day.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Turn off auto-renew in Settings at any time: you keep Pro until the end of the month or year you paid for, and you aren't charged again.",
  },
  {
    q: "What platforms does AdSpy Pro support?",
    a: "We currently support Facebook, Instagram and TikTok for ad research. Store tracking works for any Shopify-based store. We're actively adding support for more platforms.",
  },
  {
    q: "Is AdSpy Pro suitable for beginners?",
    a: "Yes! The interface is designed to be intuitive regardless of experience level. We also provide tutorials, a knowledge base, and responsive support to help you get the most out of the platform.",
  },
  {
    q: "Do you offer refunds?",
    a: "The Free plan lets you test the platform before paying. If you experience a technical issue that our team can't resolve, we'll consider refunds on a case-by-case basis.",
  },
  {
    q: "Can I use AdSpy Pro for Amazon or Etsy?",
    a: "Currently our focus is on Facebook/TikTok ads and Shopify stores. Amazon and Etsy research features are on our roadmap for future updates.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between px-6 py-5 bg-card">
        <span className="font-semibold text-sm pr-4">{q}</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <div className="px-6 pb-5 pt-0 text-sm text-muted-foreground leading-relaxed bg-card border-t border-border">
              {a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  return (
    <section id="faq" className="py-24 bg-card/20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Frequently asked questions
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          {faqs.map((faq) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
