import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { BUILT_IN, buildKnowledge, type Knowledge } from "@/lib/knowledge.ts";

/** The Knowledge content the pages show: an admin's saved edits, else the built-in guides. Undefined while loading. */
export function useKnowledge(): Knowledge | undefined {
  const saved = useQuery(api.knowledge.content);
  return useMemo(() => (saved === undefined ? undefined : buildKnowledge(saved ?? BUILT_IN)), [saved]);
}
