import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Back to a list should land where the user left it: same filters, same number of items loaded, same scroll.
// Each browser history entry has its own location.key, so what's kept under it comes back on Back/Forward
// and a fresh visit (a new key) starts clean. Kept in sessionStorage: this tab only, gone when it closes.

const read = (key: string): unknown => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the page just doesn't remember.
  }
};

/** useState that comes back when the user returns to this history entry (Back/Forward). */
export function useHistoryState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { key, pathname } = useLocation();
  const storageKey = `page:${key}:${pathname}:${name}`;
  const [value, setValue] = useState<T>(() => {
    const saved = read(storageKey);
    if (saved !== undefined) return saved as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => write(storageKey, value), [storageKey, value]);
  return [value, setValue];
}

/**
 * For a "Load more" list: how many items to ask for first (as many as were loaded before the user left, at most
 * `max`), and a function to call with the count now shown.
 */
export function useLoadedCount(name: string, page: number, max = 300): [initial: number, remember: (n: number) => void] {
  const [count, setCount] = useHistoryState(`${name}:loaded`, page);
  const [initial] = useState(() => Math.min(max, Math.max(page, count)));
  const remember = useCallback((n: number) => setCount((prev) => (prev === n ? prev : n)), [setCount]);
  return [initial, remember];
}

/**
 * The dashboard scrolls inside <main>, not the window, so the browser can't restore it. This remembers each
 * history entry's scroll and puts it back on Back/Forward once the page is tall enough (lists load after the
 * page opens), giving up after a few seconds or as soon as the user scrolls. A new page starts at the top.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>) {
  const { key } = useLocation();
  const navigation = useNavigationType();
  const current = useRef(key);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => write(`scroll:${current.current}`, Math.round(el.scrollTop)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref]);

  useLayoutEffect(() => {
    current.current = key;
    const el = ref.current;
    if (!el) return;
    if (navigation !== "POP") {
      // Replacing the URL (a tab or filter in it) keeps the place; a new page starts at the top.
      if (navigation === "PUSH") el.scrollTop = 0;
      return;
    }
    const target = Number(read(`scroll:${key}`)) || 0;
    if (!target) {
      el.scrollTop = 0;
      return;
    }
    let frame = 0;
    let done = false;
    const stop = () => {
      done = true;
    };
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    for (const e of events) el.addEventListener(e, stop, { passive: true, once: true });
    const started = Date.now();
    const tick = () => {
      if (done) return;
      if (el.scrollHeight - el.clientHeight >= target || Date.now() - started > 6000) {
        el.scrollTop = target;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      for (const e of events) el.removeEventListener(e, stop);
    };
  }, [key, navigation, ref]);
}
