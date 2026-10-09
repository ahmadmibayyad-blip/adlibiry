import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookText, Search } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { glossary } from "@/lib/knowledge.ts";

// The Knowledge glossary: the terms the guides use, A to Z, searchable.
export default function KnowledgeGlossary() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? glossary.filter(([term, def]) => `${term} ${def}`.toLowerCase().includes(needle)) : glossary;

  return (
    <div className="p-5 lg:p-8 max-w-3xl mx-auto">
      <Link to="/dashboard/knowledge" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft className="w-4 h-4" /> Knowledge
      </Link>
      <div className="flex items-center gap-2.5 mb-1">
        <BookText className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold">Glossary</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">The terms used in the guides, in plain words.</p>
      <div className="relative mb-5">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms" className="pl-9" aria-label="Search terms" />
      </div>
      {shown.length ? (
        <dl className="bg-card border border-border rounded-xl divide-y divide-border">
          {shown.map(([term, def]) => (
            <div key={term} className="p-4 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-semibold text-sm">{term}</dt>
              <dd className="text-sm text-muted-foreground mt-0.5 sm:mt-0">{def}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-10">No term matches "{q.trim()}".</p>
      )}
    </div>
  );
}
