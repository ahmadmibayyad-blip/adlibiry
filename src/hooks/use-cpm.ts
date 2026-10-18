import { useCallback, useSyncExternalStore } from "react";
import { CPM_STORAGE_KEY, clampCpm, readCpm } from "@/lib/euSpend.ts";

// The user's CPM for EU spend estimates, shared by every component on the
// page (and other tabs, through the storage event).
const EVENT = "adspy-cpm-change";

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === CPM_STORAGE_KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCpm(): [number, (cpm: number) => void] {
  const cpm = useSyncExternalStore(subscribe, readCpm, readCpm);
  const setCpm = useCallback((next: number) => {
    try {
      localStorage.setItem(CPM_STORAGE_KEY, String(clampCpm(next)));
    } catch {
      // Private mode: the setting just doesn't stick.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [cpm, setCpm];
}
