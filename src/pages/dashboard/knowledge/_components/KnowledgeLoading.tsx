import { Spinner } from "@/components/ui/spinner.tsx";

/** Shown for the moment the Knowledge pages wait for the guides to load. */
export default function KnowledgeLoading() {
  return (
    <div className="flex justify-center py-24">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}
