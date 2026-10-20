import { useCallback, useSyncExternalStore } from "react";

// Simple view: a beginner home (one product at a time) and a short menu.
// Kept per browser for now; Full is the default, so nothing changes for
// anyone who doesn't switch.
const KEY = "adspy-simple-view";
const EVENT = "adspy-simple-view-change";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSimpleView(): [boolean, (simple: boolean) => void] {
  const simple = useSyncExternalStore(subscribe, read, () => false);
  const setSimple = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Private mode: the choice just doesn't stick.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [simple, setSimple];
}
