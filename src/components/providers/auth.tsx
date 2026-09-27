// Auth is provided by ConvexAuthProvider (see convex.tsx). Kept as a
// passthrough so the provider tree stays the same.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
