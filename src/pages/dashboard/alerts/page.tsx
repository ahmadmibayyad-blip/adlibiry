import { Bell, BellRing, Package, Megaphone, Store, Check } from "lucide-react";
import { motion } from "motion/react";
import { usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Authenticated, Unauthenticated } from "convex/react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import AlertPreferencesPanel from "./_components/AlertPreferencesPanel.tsx";
import FollowingPanel from "./_components/FollowingPanel.tsx";
import FollowedProductsPanel from "./_components/FollowedProductsPanel.tsx";

type Notification = Doc<"notifications">;

const typeIcons: Record<string, typeof Package> = {
  new_winner: Package,
  new_ad: Megaphone,
  store_update: Store,
  advertiser_ads: BellRing,
  product_follow: BellRing,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationRow({ notification, onOpen }: { notification: Notification; onOpen: (n: Notification) => void }) {
  const Icon = typeIcons[notification.type] ?? Bell;
  return (
    <button
      onClick={() => onOpen(notification)}
      className={cn(
        "w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all cursor-pointer",
        notification.isRead
          ? "bg-card border-border"
          : "bg-primary/5 border-primary/30"
      )}
    >
      <div className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
        notification.isRead ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{notification.title}</span>
          {!notification.isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <p className="text-[11px] text-muted-foreground mt-1.5">{timeAgo(notification.createdAt)}</p>
      </div>
    </button>
  );
}

function AlertsFeed() {
  const navigate = useNavigate();
  const markAsRead = useMutation(api.notifications.markAsRead);
  const markAllAsRead = useMutation(api.notifications.markAllAsRead);

  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.list,
    {},
    { initialNumItems: 20 }
  );

  const handleOpen = async (n: Notification) => {
    if (!n.isRead) {
      await markAsRead({ id: n._id });
    }
    navigate(n.link);
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead({});
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">Notifications</h2>
        {results.length > 0 && (
          <Button size="sm" variant="ghost" onClick={handleMarkAllRead} className="text-xs h-7">
            <Check className="w-3.5 h-3.5 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Bell /></EmptyMedia>
            <EmptyTitle>No notifications yet</EmptyTitle>
            <EmptyDescription>
              Set up your alert preferences below to get notified about new winners, ads in your niches, and tracked store updates.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2">
          {results.map((n) => (
            <NotificationRow key={n._id} notification={n} onOpen={handleOpen} />
          ))}
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center mt-6">
          <Button variant="secondary" onClick={() => loadMore(20)}>Load more</Button>
        </div>
      )}
    </div>
  );
}

export default function AlertsPage() {
  return (
    <div className="p-5 lg:p-8 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <Bell className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold">Alerts</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Get notified the moment a new winning product, a new ad in your niches, or an update from a tracked store shows up.
        </p>
      </motion.div>

      <Unauthenticated>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Bell /></EmptyMedia>
            <EmptyTitle>Sign in to manage alerts</EmptyTitle>
            <EmptyDescription>Create an account to set up notifications and never miss a winning product.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Unauthenticated>

      <Authenticated>
        <div className="space-y-8">
          <AlertPreferencesPanel />
          <FollowingPanel />
          <FollowedProductsPanel />
          <AlertsFeed />
        </div>
      </Authenticated>
    </div>
  );
}
