import type { Level } from "@/lib/knowledge.ts";
import { cn } from "@/lib/utils.ts";

const STYLE: Record<Level, string> = {
  Beginner: "bg-good/15 text-good",
  Intermediate: "bg-warn/15 text-warn",
  Advanced: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

export default function LevelTag({ level, className }: { level: Level; className?: string }) {
  return <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", STYLE[level], className)}>{level}</span>;
}
