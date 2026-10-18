import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMediaFallback } from "./useMediaFallback.ts";

describe("useMediaFallback", () => {
  it("tries the source link, then our copy, then gives up", () => {
    const { result } = renderHook(() => useMediaFallback("https://meta.example/a.jpg", "https://convex.example/a"));
    expect(result.current.src).toBe("https://meta.example/a.jpg");
    act(() => result.current.onError());
    expect(result.current.src).toBe("https://convex.example/a");
    act(() => result.current.onError());
    expect(result.current.failed).toBe(true);
  });

  it("uses our copy when there's no source link, and fails without either", () => {
    expect(renderHook(() => useMediaFallback("", "https://convex.example/a")).result.current.src).toBe("https://convex.example/a");
    expect(renderHook(() => useMediaFallback(undefined, undefined)).result.current.failed).toBe(true);
  });
});
