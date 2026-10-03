// Turns whatever a daily import returned (or threw) into one run-log row.
// Pure, so it's unit tested in importRuns.test.ts.

export type RunStatus = "ok" | "partial" | "failed" | "skipped";
export type RunSummary = { status: RunStatus; summary: string; errors: string[] };

const MAX_ERRORS = 10;
const MAX_ERROR_LENGTH = 300;
// Counts that mean "something was brought in"; used to tell partial from failed.
const PROGRESS_KEYS = ["created", "updated", "fetched", "started", "adsCreated", "adsUpdated", "productsCreated"];

export function summarizeRun(outcome: { result?: unknown; thrown?: unknown }): RunSummary {
  if (outcome.thrown !== undefined) {
    return { status: "failed", summary: "Stopped with an error", errors: [errorText(outcome.thrown)] };
  }
  const r = (outcome.result && typeof outcome.result === "object" ? outcome.result : {}) as Record<string, unknown>;
  if (typeof r.notConfigured === "string") return { status: "skipped", summary: r.notConfigured, errors: [] };

  const errors = (Array.isArray(r.errors) ? r.errors : []).map(errorText).slice(0, MAX_ERRORS);
  const counts = Object.entries(r)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([k, v]) => `${k} ${v}`);
  const progressed = PROGRESS_KEYS.some((k) => typeof r[k] === "number" && (r[k] as number) > 0);
  const status: RunStatus = errors.length === 0 ? "ok" : progressed ? "partial" : "failed";
  return { status, summary: counts.join(", ") || "Finished", errors };
}

function errorText(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "object"
          ? String(((e as { data: { message?: unknown } }).data?.message) ?? JSON.stringify(e))
          : JSON.stringify(e);
  return raw.length > MAX_ERROR_LENGTH ? `${raw.slice(0, MAX_ERROR_LENGTH)}…` : raw;
}
