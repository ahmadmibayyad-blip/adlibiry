import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import Index from "./pages/Index.tsx";
import { INFO_PAGES } from "./pages/info/content.ts";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { PageLoading } from "./components/PageLoading.tsx";
import { SignInButton } from "./components/ui/signin.tsx";
import { LogoMark } from "./components/Logo.tsx";
import { useServiceWorker } from "./hooks/use-service-worker.ts";

// Pages load when first opened, so the home page doesn't download the whole dashboard.
const AuthCallback = lazy(() => import("./pages/auth/Callback.tsx"));
const LoginPage = lazy(() => import("./pages/auth/Login.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const DashboardLayout = lazy(() => import("./pages/dashboard/_components/DashboardLayout.tsx"));
const DashboardHome = lazy(() => import("./pages/dashboard/page.tsx"));
const ProductsFeed = lazy(() => import("./pages/dashboard/products/page.tsx"));
const ProductDetail = lazy(() => import("./pages/dashboard/products/[id].tsx"));
const SavedProducts = lazy(() => import("./pages/dashboard/saved/page.tsx"));
const AdSpyPage = lazy(() => import("./pages/dashboard/ad-spy/page.tsx"));
const StudioPage = lazy(() => import("./pages/dashboard/studio/page.tsx"));
const OfferSearchPage = lazy(() => import("./pages/dashboard/offer-search/page.tsx"));
const PageBuilderPage = lazy(() => import("./pages/dashboard/page-builder/page.tsx"));
const ProfitPage = lazy(() => import("./pages/dashboard/profit/page.tsx"));
const OrdersPage = lazy(() => import("./pages/dashboard/orders/page.tsx"));
const AdQueuePage = lazy(() => import("./pages/dashboard/ad-queue/page.tsx"));
const AdDetailPage = lazy(() => import("./pages/dashboard/ads/[id].tsx"));
const WinnersPage = lazy(() => import("./pages/dashboard/winners/page.tsx"));
const AgentsPage = lazy(() => import("./pages/dashboard/agents/page.tsx"));
const HooksPage = lazy(() => import("./pages/dashboard/hooks/page.tsx"));
const InfoPage = lazy(() => import("./pages/info/page.tsx"));
const Referral = lazy(() => import("./pages/Referral.tsx"));
const ResearchPage = lazy(() => import("./pages/dashboard/research/page.tsx"));
const StoreTrackerPage = lazy(() => import("./pages/dashboard/stores/page.tsx"));
const AlertsPage = lazy(() => import("./pages/dashboard/alerts/page.tsx"));
const ExtensionPage = lazy(() => import("./pages/dashboard/extension/page.tsx"));
const SettingsPage = lazy(() => import("./pages/dashboard/settings/page.tsx"));
const AdminPage = lazy(() => import("./pages/dashboard/admin/page.tsx"));
const UnsubscribePage = lazy(() => import("./pages/Unsubscribe.tsx"));
const TikTokShopPage = lazy(() => import("./pages/dashboard/tiktok-shop/page.tsx"));
const KnowledgeHub = lazy(() => import("./pages/dashboard/knowledge/page.tsx"));
const KnowledgeTopic = lazy(() => import("./pages/dashboard/knowledge/topic.tsx"));
const KnowledgeCalculator = lazy(() => import("./pages/dashboard/knowledge/calculator.tsx"));
const KnowledgeGlossary = lazy(() => import("./pages/dashboard/knowledge/glossary.tsx"));
const LaunchesPage = lazy(() => import("./pages/dashboard/launches/page.tsx"));

function DashboardGuard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <PageLoading fullScreen />
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
        <Suspense fallback={<PageLoading fullScreen />}>
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
          {/* Affiliate links (convex/affiliates.ts) */}
          <Route path="/r/:code" element={<Referral />} />

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
            <Route path="offer-search" element={<OfferSearchPage />} />
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
            <Route path="page-builder" element={<PageBuilderPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="profit" element={<ProfitPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="ad-queue" element={<AdQueuePage />} />
            <Route path="extension" element={<ExtensionPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>

          {INFO_PAGES.map((p) => (
            <Route key={p.slug} path={`/${p.slug}`} element={<InfoPage />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </DefaultProviders>
  );
}
