import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const isAdmin = useQuery(api.users.isAdmin);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAdmin === false) {
      navigate("/dashboard");
    }
  }, [isAdmin, navigate]);

  if (isAdmin === undefined) {
    return (
      <div className="p-5 lg:p-8 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mb-3" />
        <h2 className="font-semibold text-lg mb-1">Admin access required</h2>
        <p className="text-sm text-muted-foreground">Redirecting you back to your dashboard...</p>
      </div>
    );
  }

  return <>{children}</>;
}
