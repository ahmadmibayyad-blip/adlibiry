import { Link, useLocation } from "react-router-dom";
import { useQuery } from "convex/react";
import { Mail } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { CONTACT_EMAIL } from "@/lib/site.ts";
import { compactNumber } from "@/lib/adFormat.ts";
import { cn } from "@/lib/utils.ts";
import Navbar from "../_components/Navbar.tsx";
import Footer from "../_components/Footer.tsx";
import NotFound from "../NotFound.tsx";
import { INFO_PAGES, UPDATED, pageBySlug } from "./content.ts";

// Footer info pages: About, Help Center, Privacy Policy, … (text in content.ts).

function LiveStatus() {
  const stats = useQuery(api.stats.get, {});
  const rows = [
    { label: "Products tracked", value: stats?.products.total },
    { label: "Ads tracked", value: stats?.ads.total },
  ];
  return (
    <div className="grid sm:grid-cols-3 gap-3 not-prose">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("w-2.5 h-2.5 rounded-full", stats === undefined ? "bg-muted-foreground" : "bg-good")} />
          {stats === undefined ? "Checking…" : "Database online"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">Live from AdSpy Pro</div>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="rounded-xl border border-border bg-card p-4">
          <div className="text-xl font-bold tabular-nums">{r.value === undefined ? "—" : compactNumber(r.value)}</div>
          <div className="text-xs text-muted-foreground">{r.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function InfoPage() {
  const slug = useLocation().pathname.replace(/^\//, "");
  const page = pageBySlug(slug);
  if (!page) return <NotFound />;
  const siblings = INFO_PAGES.filter((p) => p.group === page.group);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-28 pb-20 grid gap-10 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label={page.group} className="md:sticky md:top-28 self-start">
          <div className="text-sm font-semibold mb-2">{page.group}</div>
          <ul className="flex md:flex-col flex-wrap gap-1">
            {siblings.map((p) => (
              <li key={p.slug}>
                <Link
                  to={`/${p.slug}`}
                  className={cn(
                    "block text-sm rounded-md px-2.5 py-1.5",
                    p.slug === page.slug ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">{page.title}</h1>
          <p className="text-lg text-muted-foreground mb-8">{page.intro}</p>
          {page.slug === "status" && (
            <div className="mb-8">
              <LiveStatus />
            </div>
          )}
          <div className="space-y-8">
            {page.sections.map((s, i) => (
              <section key={i}>
                {s.heading && <h2 className="text-lg font-semibold mb-2">{s.heading}</h2>}
                {s.paragraphs?.map((p) => (
                  <p key={p} className="text-muted-foreground leading-relaxed mb-3">
                    {p}
                  </p>
                ))}
                {s.bullets && (
                  <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground leading-relaxed">
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          {CONTACT_EMAIL && (
            <a href={`mailto:${CONTACT_EMAIL}`} className="mt-10 inline-flex items-center gap-2 text-sm text-primary hover:underline">
              <Mail className="w-4 h-4" />
              {CONTACT_EMAIL}
            </a>
          )}
          {page.group === "Legal" && <p className="mt-10 text-xs text-muted-foreground">Last updated {UPDATED}.</p>}
        </article>
      </main>
      <Footer />
    </div>
  );
}
