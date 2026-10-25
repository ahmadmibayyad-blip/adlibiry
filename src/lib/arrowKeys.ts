import type { KeyboardEvent } from "react";

// Arrow keys for a radio group or a tab row (put on the role="radiogroup" / role="tablist" element): Left/Up and
// Right/Down move to the previous/next option and pick it, Home/End to the first/last; disabled options are skipped.
// Pair it with `tabIndex={rovingTabIndex(...)}` on the options so the group is one Tab stop.
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function arrowSelect(e: KeyboardEvent<HTMLElement>) {
  if (!(e.key in STEP) && e.key !== "Home" && e.key !== "End") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]')).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true",
  );
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || items.length === 0) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + STEP[e.key] + items.length) % items.length;
  items[next].focus();
  items[next].click();
}

/** 0 for the picked option (or the first one when nothing is picked yet), -1 for the rest. */
export const rovingTabIndex = (picked: boolean, index: number, anyPicked: boolean) => (picked || (!anyPicked && index === 0) ? 0 : -1);
