import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Is there a free trial?",
    a: "Yes! Every plan comes with a full 7-day free trial. No credit card required to start. You get full access to all features during your trial.",
  },
  {
    q: "How accurate is the ad spend data?",
    a: "Our spend estimates are highly accurate for Facebook and TikTok ads. We use a proprietary algorithm that analyzes ad frequency, engagement rates, and audience sizes to calculate realistic spend ranges. Most users find our data within 10-15% of actual spend.",
  },
  {
    q: "How often is the ad database updated?",
    a: "Our database is updated in real-time. New ads are discovered and indexed within minutes of going live. Store and product data is refreshed daily.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Absolutely. You can cancel your subscription at any time with no questions asked. You'll retain access until the end of your billing period.",
  },
  {
    q: "What platforms does WinningHunter support?",
    a: "We currently support Facebook/Meta, TikTok, and Pinterest for ad research. Store tracking works for any Shopify-based store. We're actively adding support for more platforms.",
  },
  {
    q: "Is WinningHunter suitable for beginners?",
    a: "Yes! Our interface is designed to be intuitive regardless of experience level. We also provide tutorials, a knowledge base, and responsive support to help you get the most out of the platform.",
  },
  {
    q: "Do you offer refunds?",
    a: "We offer a 7-day trial so you can test the platform risk-free. If you experience a technical issue that our team can't resolve, we'll consider refunds on a case-by-case basis.",
  },
  {
    q: "Can I use WinningHunter for Amazon or Etsy?",
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
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-5">
            Got Questions?
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Frequently Asked
            <span className="text-primary"> Questions</span>
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
