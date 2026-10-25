import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useCpm } from "@/hooks/use-cpm.ts";
import { formatUsd, spendFromReach } from "@/lib/euSpend.ts";
import { compactNumber } from "@/lib/adFormat.ts";

// The advertiser's est. EU spend over the ads AdSpy has of it (EU reach ×
// the user's CPM). Says how many ads it's from: it isn't the page's total.
export default function AdvertiserSpend({ name }: { name: string }) {
  const totals = useQuery(api.ads.advertiserReach, { advertiserName: name });
  const [cpm] = useCpm();
  if (!totals || totals.euAds === 0) return null;
  const spend = spendFromReach(totals.reach, cpm)!;
  const ads = `${totals.euAds}${totals.more ? "+" : ""} EU ad${totals.euAds === 1 ? "" : "s"}`;
  return (
    <p className="text-xs text-muted-foreground mb-2" title={`EU reach ${totals.reach.toLocaleString()} × $${cpm} CPM, over the ads AdSpy has of this advertiser`}>
      Advertiser: <span className="font-semibold text-foreground">{formatUsd(spend)}</span> est. EU spend · {compactNumber(totals.reach)} EU reach · {ads}
      {totals.activeAds > 0 ? ` · ${totals.activeAds} active` : ""}
    </p>
  );
}
