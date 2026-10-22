import { Link, useParams } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import Navbar from "../_components/Navbar.tsx";
import Footer from "../_components/Footer.tsx";
import NotFound from "../NotFound.tsx";
import { usePageMeta } from "@/hooks/use-page-meta.ts";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { CHECKED, COMPARE_PAGES, compareBySlug } from "./content.ts";

// /vs/<slug>: AdSpy Pro against one competitor (text in content.ts).
export default function ComparePage() {
  const { slug = "" } = useParams();
  const page = compareBySlug(slug);
  usePageMeta(page?.title ?? "Page not found", page?.description);
  if (!page) return <NotFound />;
  const others = COMPARE_PAGES.filter((p) => p.slug !== page.slug);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-20">
        <article>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">{page.title}</h1>
          <p className="text-lg text-muted-foreground mb-8">{page.intro}</p>

          <div className="overflow-x-auto rounded-xl border border-border mb-10">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3 w-[22%]" />
                  <th className="p-3 w-[39%] text-primary">AdSpy Pro</th>
                  <th className="p-3 w-[39%]">{page.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.rows.map((r) => (
                  <tr key={r.feature} className="align-top">
                    <th scope="row" className="p-3 text-left font-medium">{r.feature}</th>
                    <td className="p-3">{r.us}</td>
                    <td className="p-3 text-muted-foreground">{r.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 mb-10">
            {[
              { heading: `Where ${page.name} is stronger`, items: page.theyWin, accent: false },
              { heading: "Where AdSpy Pro is stronger", items: page.weWin, accent: true },
            ].map((col) => (
              <section key={col.heading} className={cn("rounded-xl border p-5", col.accent ? "border-primary/30 bg-primary/5" : "border-border bg-card")}>
                <h2 className="text-lg font-semibold mb-3">{col.heading}</h2>
                <ul className="space-y-2">
                  {col.items.map((i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                      <Check className={cn("w-4 h-4 mt-0.5 shrink-0", col.accent ? "text-primary" : "text-muted-foreground")} />
                      {i}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-2">Which one should you pick?</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">{page.pickThem}</p>
            <p className="text-muted-foreground leading-relaxed mb-5">{page.pickUs}</p>
            <Button asChild size="lg">
              <Link to="/login">
                Try AdSpy Pro free for 7 days, no card <ArrowRight className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
          </section>

          <p className="text-xs text-muted-foreground mb-10">
            Checked on {CHECKED} from {page.sources.join(", ")}. Prices and features change; check their site for the latest.
          </p>

          <nav aria-label="Other comparisons">
            <h2 className="text-sm font-semibold mb-2">More comparisons</h2>
            <ul className="flex flex-wrap gap-2">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link to={`/vs/${p.slug}`} className="inline-flex text-sm rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
                    AdSpy Pro vs {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </article>
      </main>
      <Footer />
    </div>
  );
}
