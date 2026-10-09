import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthCallback from "./pages/auth/Callback.tsx";
import LoginPage from "./pages/auth/Login.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import DashboardLayout from "./pages/dashboard/_components/DashboardLayout.tsx";
import DashboardHome from "./pages/dashboard/page.tsx";
import ProductsFeed from "./pages/dashboard/products/page.tsx";
import ProductDetail from "./pages/dashboard/products/[id].tsx";
import SavedProducts from "./pages/dashboard/saved/page.tsx";
import AdSpyPage from "./pages/dashboard/ad-spy/page.tsx";
import AdDetailPage from "./pages/dashboard/ads/[id].tsx";
import WinnersPage from "./pages/dashboard/winners/page.tsx";
import AgentsPage from "./pages/dashboard/agents/page.tsx";
import HooksPage from "./pages/dashboard/hooks/page.tsx";
import InfoPage from "./pages/info/page.tsx";
import { INFO_PAGES } from "./pages/info/content.ts";
import ResearchPage from "./pages/dashboard/research/page.tsx";
import StoreTrackerPage from "./pages/dashboard/stores/page.tsx";
import AlertsPage from "./pages/dashboard/alerts/page.tsx";
import ExtensionPage from "./pages/dashboard/extension/page.tsx";
import SettingsPage from "./pages/dashboard/settings/page.tsx";
import AdminPage from "./pages/dashboard/admin/page.tsx";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { SignInButton } from "./components/ui/signin.tsx";
import { LogoMark } from "./components/Logo.tsx";
import { useServiceWorker } from "./hooks/use-service-worker.ts";
import UnsubscribePage from "./pages/Unsubscribe.tsx";
import TikTokShopPage from "./pages/dashboard/tiktok-shop/page.tsx";
import KnowledgeHub from "./pages/dashboard/knowledge/page.tsx";
import KnowledgeTopic from "./pages/dashboard/knowledge/topic.tsx";
import KnowledgeCalculator from "./pages/dashboard/knowledge/calculator.tsx";
import KnowledgeGlossary from "./pages/dashboard/knowledge/glossary.tsx";
import LaunchesPage from "./pages/dashboard/launches/page.tsx";

function DashboardGuard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <LogoMark size={40} className="motion-safe:animate-pulse" />
            <Skeleton className="h-2 w-32 rounded-full" />
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-5 text-center max-w-sm px-6">
            <LogoMark size={44} />
            <div>
              <h2 className="font-display font-bold text-xl mb-1.5">Sign in to continue</h2>
              <p className="text-muted-foreground text-sm">
                Access your dashboard, saved products, and the winning products feed.
              </p>
            </div>
            <SignInButton className="w-full" />
          </div>
        </div>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}

export default function App() {
  useServiceWorker();
  return (
    <DefaultProviders defaultTheme="dark" storageKey="adspy-theme">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/login" element={<LoginPage />} />
          {/* Common addresses people type or link to */}
          {["/signup", "/sign-up", "/sign-in", "/signin", "/register"].map((path) => (
            <Route key={path} path={path} element={<Navigate to="/login" replace />} />
          ))}
          <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
          {/* Fallback from api/landing.ts when it can't read the page. */}
          <Route path="/app.html" element={<Navigate to="/" replace />} />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />

          {/* Dashboard — protected */}
          <Route
            path="/dashboard"
            element={
              <DashboardGuard>
                <DashboardLayout />
              </DashboardGuard>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="products" element={<ProductsFeed />} />
            <Route path="products/:id" element={<ProductDetail />} />
            <Route path="winners" element={<WinnersPage />} />
            <Route path="ad-spy" element={<AdSpyPage />} />
            <Route path="ads/:id" element={<AdDetailPage />} />
            <Route path="research" element={<ResearchPage />} />
            <Route path="stores" element={<StoreTrackerPage />} />
            <Route path="saved" element={<SavedProducts />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="hooks" element={<HooksPage />} />
            <Route path="tiktok-shop" element={<TikTokShopPage />} />
            <Route path="knowledge" element={<KnowledgeHub />} />
            <Route path="knowledge/tools/calculator" element={<KnowledgeCalculator />} />
            <Route path="knowledge/glossary" element={<KnowledgeGlossary />} />
            <Route path="knowledge/:topicId/:guideId?" element={<KnowledgeTopic />} />
            <Route path="launch" element={<LaunchesPage />} />
            <Route path="launch/shopify-callback" element={<LaunchesPage />} />
            <Route path="launches" element={<LaunchesPage />} />
            <Route path="extension" element={<ExtensionPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>

          {INFO_PAGES.map((p) => (
            <Route key={p.slug} path={`/${p.slug}`} element={<InfoPage />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}
