// Testimonials on the home page (src/pages/_components/Testimonials.tsx).
// Add 3–5 real ones with the customer's permission. The section stays hidden
// until there is at least one, so no placeholder ever shows.
export type Testimonial = {
  quote: string;
  name: string; // e.g. "Sarah K."
  detail?: string; // e.g. "Shopify store owner, Denmark"
};

export const TESTIMONIALS: Testimonial[] = [];
