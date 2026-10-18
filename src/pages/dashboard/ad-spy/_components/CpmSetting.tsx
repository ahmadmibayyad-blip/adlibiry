import { useState } from "react";
import { useCpm } from "@/hooks/use-cpm.ts";
import { CPM_MAX, CPM_MIN, DEFAULT_CPM } from "@/lib/euSpend.ts";

// The CPM behind every EU spend estimate (EU reach ÷ 1,000 × CPM). Kept in
// this browser; changing it updates the cards and the spend filter at once.
export default function CpmSetting() {
  const [cpm, setCpm] = useCpm();
  // What's being typed; null shows the saved CPM.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = Number(draft);
    if (draft !== null && draft.trim() !== "" && Number.isFinite(n)) setCpm(n);
    setDraft(null);
  };

  return (
    <label
      className="flex items-center gap-1.5 h-10 sm:h-8 px-2.5 rounded-lg text-xs border border-border text-muted-foreground"
      title={`Est. spend = EU reach ÷ 1,000 × this CPM (USD per 1,000 people reached). Default $${DEFAULT_CPM}.`}
    >
      CPM $
      <input
        type="number"
        inputMode="decimal"
        min={CPM_MIN}
        max={CPM_MAX}
        step="0.5"
        value={draft ?? String(cpm)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        aria-label="CPM in US dollars for spend estimates"
        className="w-12 bg-transparent text-foreground tabular-nums focus:outline-none"
      />
    </label>
  );
}
