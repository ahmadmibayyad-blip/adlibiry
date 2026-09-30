import { Link, useLocation, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils.ts";
import {
  LayoutDashboard,
  TrendingUp,
  Search,
  BookmarkCheck,
  Bell,
  Settings,
  Zap,
  ChevronRight,
  LogOut,
  Store,
  LineChart,
  ShieldCheck,
  Puzzle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";
import AIAssistant from "./ai/AIAssistant.tsx";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: TrendingUp, label: "Winning Products", href: "/dashboard/products" },
  { icon: Search, label: "Ad Spy", href: "/dashboard/ad-spy" },
  { icon: LineChart, label: "Research", href: "/dashboard/research" },
  { icon: Store, label: "Store Tracker", href: "/dashboard/stores" },
  { icon: BookmarkCheck, label: "Saved", href: "/dashboard/saved" },
  { icon: Bell, label: "Alerts", href: "/dashboard/alerts" },
  { icon: Puzzle, label: "Chrome Extension", href: "/dashboard/extension" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

const planColors: Record<string, string> = {
  starter: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  pro: "bg-primary/10 text-primary border-primary/20",
  agency: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  none: "bg-muted text-muted-foreground border-border",
};

export default function DashboardLayout() {
  const location = useLocation();
  const { user, signout } = useAuth();
  const { plan } = useUserPlan();
  const isAdmin = useQuery(api.users.isAdmin);
  const unreadCount = useQuery(api.notifications.getUnreadCount, user ? {} : "skip");

  const initials = user?.profile?.name
    ? user.profile.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  const items = isAdmin
    ? [...navItems, { icon: ShieldCheck, label: "Admin", href: "/dashboard/admin" }]
    : navItems;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-60 border-r border-border bg-sidebar shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-14 border-b border-border">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-base tracking-tight">
            AdSpy<span className="text-primary">Pro</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = item.href === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/dashboard/alerts" && !!unreadCount && unreadCount > 0 && (
                      <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium min-w-[18px] text-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                    {active && <ChevronRight className="w-3 h-3 opacity-50" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <Avatar className="w-7 h-7">
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{user?.profile?.name ?? "User"}</div>
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0 capitalize mt-0.5", planColors[plan])}
              >
                {plan === "none" ? "Free" : plan}
              </Badge>
            </div>
            <button
              onClick={() => signout()}
              className="p-1 rounded hover:bg-secondary transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — mobile */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-base">
              AdSpy<span className="text-primary">Pro</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link
                to="/dashboard/admin"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer",
                  location.pathname.startsWith("/dashboard/admin")
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-primary/10 text-primary border-primary/20"
                )}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin
              </Link>
            )}
            <Avatar className="w-7 h-7">
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </main>
        <AIAssistant />

        {/* Bottom nav — mobile */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 flex border-t border-border bg-sidebar z-50">
          {navItems.slice(0, 5).map((item) => {
            const active = item.href === "/dashboard"
              ? location.pathname === "/dashboard"
              : location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors cursor-pointer",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px]">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
