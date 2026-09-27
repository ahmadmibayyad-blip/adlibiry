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

type Submission = Doc<"submittedAds">;

function ApproveDialog({
  submission,
  open,
  onOpenChange,
}: {
  submission: Submission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const approveSubmission = useMutation(api.submittedAds.approveSubmission);
  const [niche, setNiche] = useState("");
  const [country, setCountry] = useState("US");
  const [spendEstimate, setSpendEstimate] = useState("$1K–$5K/mo");
  const [views, setViews] = useState("Unknown");
  const [aiScore, setAiScore] = useState("70");
  const [submitting, setSubmitting] = useState(false);

  const handleApprove = async () => {
    if (!submission || !niche.trim()) {
      toast.error("Niche is required");
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
        aiScore: Number(aiScore) || 0,
      });
      toast.success("Ad approved and added to Ad Spy");
      onOpenChange(false);
      setNiche("");
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
              <Input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">AI score (0-100)</label>
              <Input type="number" min={0} max={100} value={aiScore} onChange={(e) => setAiScore(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Spend estimate</label>
              <Input value={spendEstimate} onChange={(e) => setSpendEstimate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Views</label>
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
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.platform}</div>
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
      <ApproveDialog
        submission={approveTarget}
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
      />
    </div>
  );
}
