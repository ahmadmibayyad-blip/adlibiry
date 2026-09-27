import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { usePushNotifications } from "@/hooks/use-push-notifications.ts";
import { useAuth } from "@/hooks/use-auth.ts";

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function PushNotificationRow() {
  const { user } = useAuth();
  const { status, subscribe, unsubscribe } = usePushNotifications(!!user);

  if (status === "unsupported") return null;

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-border">
      <div>
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
          Push notifications
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {status === "iframe"
            ? "Push notifications only work on the published app, not in this preview."
            : status === "denied"
              ? "Blocked in your browser. Enable in site settings, then refresh."
              : "Get instant alerts on this device, even when AdSpy Pro is closed."}
        </div>
      </div>
      {status === "iframe" || status === "denied" ? (
        <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
      ) : status === "loading" ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
      ) : status === "subscribed" ? (
        <Button size="sm" variant="secondary" onClick={() => unsubscribe()} className="shrink-0">
          <BellOff className="w-3.5 h-3.5 mr-1.5" />
          Disable
        </Button>
      ) : (
        <Button size="sm" onClick={() => subscribe()} className="shrink-0">
          <Bell className="w-3.5 h-3.5 mr-1.5" />
          Enable
        </Button>
      )}
    </div>
  );
}

export default function AlertPreferencesPanel() {
  const prefs = useQuery(api.notifications.getPreferences, {});
  const allNiches = useQuery(api.ads.getNiches, {});
  const updatePreferences = useMutation(api.notifications.updatePreferences);
  const [saving, setSaving] = useState(false);

  if (prefs === undefined) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  const save = async (overrides: Partial<{
    watchedNiches: string[];
    notifyNewWinners: boolean;
    notifyNewAdsInNiches: boolean;
    notifyTrackedStoreUpdates: boolean;
    emailDigestEnabled: boolean;
  }>) => {
    setSaving(true);
    try {
      await updatePreferences({
        watchedNiches: prefs.watchedNiches,
        notifyNewWinners: prefs.notifyNewWinners,
        notifyNewAdsInNiches: prefs.notifyNewAdsInNiches,
        notifyTrackedStoreUpdates: prefs.notifyTrackedStoreUpdates,
        emailDigestEnabled: prefs.emailDigestEnabled,
        ...overrides,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save preferences";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleNiche = (niche: string) => {
    const next = prefs.watchedNiches.includes(niche)
      ? prefs.watchedNiches.filter((n) => n !== niche)
      : [...prefs.watchedNiches, niche];
    save({ watchedNiches: next });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-sm">Alert preferences</h2>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground mb-3">Choose what triggers a notification.</p>

      <div className="divide-y divide-border/50">
        <ToggleRow
          label="New winning products"
          description="Get notified whenever a new product is marked as a Winner of the Day."
          checked={prefs.notifyNewWinners}
          onCheckedChange={(v) => save({ notifyNewWinners: v })}
        />
        <ToggleRow
          label="New ads in watched niches"
          description="Get notified when a new ad is spotted in a niche you're watching below."
          checked={prefs.notifyNewAdsInNiches}
          onCheckedChange={(v) => save({ notifyNewAdsInNiches: v })}
        />
        <ToggleRow
          label="Tracked store updates"
          description="Get notified when a store on your Store Tracker watchlist changes."
          checked={prefs.notifyTrackedStoreUpdates}
          onCheckedChange={(v) => save({ notifyTrackedStoreUpdates: v })}
        />
        <ToggleRow
          label="Daily email digest"
          description="Receive a daily email summarizing today's winning products."
          checked={prefs.emailDigestEnabled}
          onCheckedChange={(v) => save({ emailDigestEnabled: v })}
        />
        <PushNotificationRow />
      </div>

      {allNiches && allNiches.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-sm font-medium mb-2">Watched niches</div>
          <div className="flex flex-wrap gap-1.5">
            {allNiches.map((niche) => (
              <button
                key={niche}
                onClick={() => toggleNiche(niche)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border",
                  prefs.watchedNiches.includes(niche)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {niche}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
