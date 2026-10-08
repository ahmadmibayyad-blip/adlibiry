import { Link, useLocation, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils.ts";
import {
  LayoutDashboard,
  TrendingUp,
  Search,
  BookmarkCheck,
  Bell,
  Bot,
  Sparkles,
  Settings,
  LogOut,
  Store,
  LineChart,
  ShieldCheck,
  Puzzle,
  Trophy,
  ShoppingBag, Rocket, Menu } from "lucide-react";
import { useAuth } from "@/hooks/use-auth.ts";
import { useUserPlan } from "@/hooks/use-user-plan.ts";
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";
import AIAssistant from "./ai/AIAssistant.tsx";
import { openAssistant } from "@/lib/assistant.ts";
import { setDisplayCurrency } from "@/lib/money.ts";
import Logo from "@/components/Logo.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import OnboardingDialog from "./OnboardingDialog.tsx";

// `short` is the label in the bottom bar on phones and tablets: the first 4 items and "More" (5 at 360px wide),
// which opens every page.
const navItems: { icon: typeof Search; label: string; href: string; short?: string }[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", short: "Home" },
  { icon: Trophy, label: "Winning Products", href: "/dashboard/winners", short: "Winners" },
  { icon: TrendingUp, label: "Products", href: "/dashboard/products" },
  { icon: Search, label: "Ad Spy", href: "/dashboard/ad-spy" },
  { icon: Sparkles, label: "Hooks of the week", href: "/dashboard/hooks", short: "Hooks" },
  { icon: ShoppingBag, label: "TikTok Shop", href: "/dashboard/tiktok-shop" },
  { icon: LineChart, label: "Research", href: "/dashboard/research" },
  { icon: Store, label: "Store Tracker", href: "/dashboard/stores" },
  { icon: Rocket, label: "Launch", href: "/dashboard/launch" },
  { icon: BookmarkCheck, label: "Saved", href: "/dashboard/saved" },
  { icon: Bot, label: "AI Agents", href: "/dashboard/agents" },
  { icon: Bell, label: "Alerts", href: "/dashboard/alerts" },
  { icon: Puzzle, label: "Chrome Extension", href: "/dashboard/extension" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

const planColors: Record<string, string> = {
  starter: "bg-chart-3/10 text-chart-3 border-chart-3/20",
  pro: "bg-primary/10 text-primary border-primary/20",
  agency: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  none: "bg-muted text-muted-foreground border-border",
};

export default function DashboardLayout() {

  const location = useLocation();
  const { user, signout } = useAuth();
  const { plan } = useUserPlan();
  const isAdmin = useQuery(api.users.isAdmin);
  const unreadCount = useQuery(api.notifications.getUnreadCount, user ? {} : "skip");
  const refreshMyPlan = useAction(api.proPlan.refreshMyPlan);
  // The user's display currency for every amount on the page (lib/money.ts).
  const currency = useQuery(api.currency.mine, {});
  if (currency) setDisplayCurrency(currency.code, currency.rate);

  // Re-read the plan from the AdSpy Pro backend when pages open (the server
  // checks at most every 2 minutes), so an ended subscription shows as Free.
  useEffect(() => {
    if (user) refreshMyPlan({}).catch(() => {});
  }, [user, location.pathname, refreshMyPlan]);

  const initials = user?.profile?.name
    ? user.profile.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => (href === "/dashboard" ? location.pathname === "/dashboard" : location.pathname.startsWith(href));
  const items = isAdmin
    ? [...navItems, { icon: ShieldCheck, label: "Admin", href: "/dashboard/admin" }]
    : navItems;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex flex-col w-60 border-r border-border bg-sidebar shrink-0">
        {/* Logo */}
        <div className="flex items-center px-5 h-14 border-b border-border">
          <Logo />
        </div>
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={openAssistant}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Ask AI
          </button>
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
              aria-label="Sign out"
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
        <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar shrink-0">
          <Logo />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openAssistant}
              aria-label="Open AI assistant"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ask AI
            </button>
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
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {/* Remount pages when the currency changes so every amount updates. */}
          <Outlet key={currency?.code ?? "USD"} />
        </main>
        <AIAssistant />
        <OnboardingDialog />

        {/* Bottom nav — mobile */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 flex border-t border-border bg-sidebar z-50 pb-[env(safe-area-inset-bottom)]">
          {navItems.slice(0, 4).map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center gap-1 py-2.5 px-0.5 text-xs font-medium transition-colors cursor-pointer",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight text-center whitespace-nowrap">{item.short ?? item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="All pages"
            className={cn(
              "relative flex-1 min-w-0 flex flex-col items-center gap-1 py-2.5 px-0.5 text-xs font-medium transition-colors cursor-pointer",
              items.slice(4).some((i) => isActive(i.href)) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] leading-tight text-center whitespace-nowrap">More</span>
            {!!unreadCount && unreadCount > 0 && <span className="absolute top-2 right-[calc(50%-14px)] w-2 h-2 rounded-full bg-primary" aria-hidden />}
          </button>
        </nav>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="lg:hidden max-h-[85vh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <SheetHeader>
              <SheetTitle>All pages</SheetTitle>
            </SheetHeader>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1 px-4">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium",
                      isActive(item.href) ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary",
                    )}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    {item.href === "/dashboard/alerts" && !!unreadCount && unreadCount > 0 && (
                      <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">{unreadCount > 9 ? "9+" : unreadCount}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="px-4 pt-2">
              <button
                type="button"
                onClick={() => signout()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
