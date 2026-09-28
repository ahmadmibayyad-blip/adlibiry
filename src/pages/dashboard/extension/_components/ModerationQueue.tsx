import { useState } from "react";
import { usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Check, X, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from "@/components/ui/empty.tsx";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { guessCategory } from "@/convex/lib/category.ts";
import { scoreFromSignals, daysSince } from "@/convex/lib/extensionSubmission.ts";
import { compactNumber, flag, domainOf } from "@/lib/adFormat.ts";

type Submission = Doc<"submittedAds">;

// Pre-fill the approval form from what the extension actually scraped —
// never invented numbers (it used to default every ad to "$1K–$5K/mo" spend,
// score 70 and country US).
function defaultsFor(s: Submission) {
  return {
    // "Other" isn't a real niche — leave it blank so the admin picks one.
    niche: ((c) => (c === "Other" ? "" : c))(guessCategory(`${s.headline} ${s.bodyText.slice(0, 200)}`)),
    country: s.countries?.[0] ?? "",
    spendEstimate: "Unknown",
    views: s.impressions ? compactNumber(s.impressions) : "0",
    aiScore: String(scoreFromSignals(s)),
  };
}

function ApproveDialog({
  submission,
  open,
  onOpenChange,
}: {
  submission: Submission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const approveSubmission = useMutation(api.submittedAds.approveSubmission);
  const [initial] = useState(() => defaultsFor(submission));
  const [niche, setNiche] = useState(initial.niche);
  const [country, setCountry] = useState(initial.country);
  const [spendEstimate, setSpendEstimate] = useState(initial.spendEstimate);
  const [views, setViews] = useState(initial.views);
  const [aiScore, setAiScore] = useState(initial.aiScore);
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = async () => {
    if (!niche.trim()) {
      toast.error("Niche is required");
      return;
    }
    if (!/^([A-Za-z]{2}|INTL)$/i.test(country.trim())) {
      toast.error("Country must be a 2-letter code (e.g. DK) or INTL");
      return;
    }
    setSubmitting(true);
    try {
      await approveSubmission({
        id: submission._id,
        niche: niche.trim(),
        country,
        spendEstimate,
        views,
        aiScore: Math.min(100, Math.max(0, Number(aiScore) || 0)),
      });
      toast.success("Ad approved and added to Ad Spy");
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve submission";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve submission</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Niche</label>
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Health & Wellness" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Country code</label>
              <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={4} placeholder="DK or INTL" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Score (0-100, from run time + engagement)</label>
              <Input type="number" min={0} max={100} value={aiScore} onChange={(e) => setAiScore(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Spend estimate</label>
              <Input value={spendEstimate} onChange={(e) => setSpendEstimate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Views / reach</label>
              <Input value={views} onChange={(e) => setViews(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleApprove} disabled={submitting}>
            Approve &amp; publish to Ad Spy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModerationQueue() {
  const [approveTarget, setApproveTarget] = useState<Submission | null>(null);
  const rejectSubmission = useMutation(api.submittedAds.rejectSubmission);

  const { results, status, loadMore } = usePaginatedQuery(
    api.submittedAds.listSubmitted,
    { status: "pending" },
    { initialNumItems: 10 }
  );

  const handleReject = async (id: Submission["_id"]) => {
    try {
      await rejectSubmission({ id });
      toast.success("Submission rejected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject submission";
      toast.error(message);
    }
  };

  if (status === "LoadingFirstPage") {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
          <EmptyTitle>No pending submissions</EmptyTitle>
          <EmptyDescription>Ads collected by extension users will show up here for review.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      <div className="space-y-2">
        {results.map((s) => (
          <div key={s._id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3">
            {s.creativeUrl ? (
              <img src={s.creativeUrl} alt={s.advertiserName} className="w-12 h-12 rounded-lg object-cover shrink-0 bg-muted" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-muted shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.advertiserName}</div>
              <div className="text-xs text-muted-foreground truncate">{s.headline}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                <span>{s.platform}</span>
                {s.mediaType && <span className="capitalize">{s.mediaType}</span>}
                {s.startedAt && <span>{daysSince(s.startedAt)}d running</span>}
                {s.isActive !== undefined && <span>{s.isActive ? "Active" : "Inactive"}</span>}
                {s.likes !== undefined && <span>♥ {compactNumber(s.likes)}</span>}
                {s.comments !== undefined && <span>💬 {compactNumber(s.comments)}</span>}
                {s.shares !== undefined && <span>↗ {compactNumber(s.shares)}</span>}
                {s.impressions !== undefined && <span>👁 {compactNumber(s.impressions)}</span>}
                {s.ctaText && <span className="border border-border rounded px-1">{s.ctaText}</span>}
                {s.countries?.length ? <span title={s.countries.join(", ")}>{s.countries.slice(0, 4).map(flag).join(" ")}{s.countries.length > 4 ? ` +${s.countries.length - 4}` : ""}</span> : null}
                {(s.adLibraryUrl || s.landingPageUrl) && (
                  <a href={s.adLibraryUrl || s.landingPageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {s.adLibraryUrl ? "Ad Library" : domainOf(s.landingPageUrl) || "Link"}
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="icon-sm" variant="ghost" onClick={() => setApproveTarget(s)} className="text-primary hover:text-primary">
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => handleReject(s._id)} className="text-destructive hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {status === "CanLoadMore" && (
        <div className="flex justify-center mt-4">
          <Button variant="secondary" onClick={() => loadMore(10)}>Load more</Button>
        </div>
      )}
      {approveTarget && (
        <ApproveDialog
          key={approveTarget._id}
          submission={approveTarget}
          open
          onOpenChange={(open) => !open && setApproveTarget(null)}
        />
      )}
    </div>
  );
}
