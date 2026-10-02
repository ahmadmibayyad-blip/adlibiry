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
import ResearchPage from "./pages/dashboard/research/page.tsx";
import StoreTrackerPage from "./pages/dashboard/stores/page.tsx";
import AlertsPage from "./pages/dashboard/alerts/page.tsx";
import ExtensionPage from "./pages/dashboard/extension/page.tsx";
import SettingsPage from "./pages/dashboard/settings/page.tsx";
import AdminPage from "./pages/dashboard/admin/page.tsx";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { SignInButton } from "./components/ui/signin.tsx";
import { Zap } from "lucide-react";
import { useServiceWorker } from "./hooks/use-service-worker.ts";

function DashboardGuard({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground animate-pulse" />
            </div>
            <Skeleton className="h-2 w-32 rounded-full" />
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-5 text-center max-w-sm px-6">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-bold text-xl mb-1.5">Sign in to continue</h2>
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
            <Route path="extension" element={<ExtensionPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}
