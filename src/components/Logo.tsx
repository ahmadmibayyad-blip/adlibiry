import { cn } from "@/lib/utils.ts";

// The AdSpy Pro target mark: two rings and a pointer, in the brand orange.
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--brand)"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12 L19 5" />
    </svg>
  );
}

export default function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-display font-bold tracking-tight text-[17px]", className)}>
      <LogoMark size={size} />
      AdSpy Pro
    </span>
  );
}
