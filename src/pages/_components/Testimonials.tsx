import { Quote } from "lucide-react";
import { TESTIMONIALS } from "@/content/testimonials.ts";

// What sellers say (src/content/testimonials.ts). Hidden while empty.
export default function Testimonials() {
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section className="py-20" aria-labelledby="testimonials-heading">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 id="testimonials-heading" className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-center mb-10">
          What sellers say
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.slice(0, 5).map((t) => (
            <figure key={t.name} className="bg-card border border-border rounded-2xl p-6 flex flex-col">
              <Quote className="w-5 h-5 text-primary mb-3" aria-hidden="true" />
              <blockquote className="text-sm leading-relaxed flex-1">{t.quote}</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{t.name}</span>
                {t.detail && <span className="block text-xs text-muted-foreground">{t.detail}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
