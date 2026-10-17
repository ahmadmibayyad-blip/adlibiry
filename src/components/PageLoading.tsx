import { LogoMark } from "./Logo.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

// Shown while a page's code downloads (pages are lazy-loaded in App.tsx).
export function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? "flex h-screen items-center justify-center" : "flex h-64 items-center justify-center"}>
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={40} className="motion-safe:animate-pulse" />
        <Skeleton className="h-2 w-32 rounded-full" />
      </div>
    </div>
  );
}
