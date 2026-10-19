import { describe, expect, it, vi } from "vitest";
import { isWriteConflict, retryOnConflict } from "./writeConflict";

const conflict = new Error(
  'Uncaught Error: Documents read from or written to the "syncLinks" table changed while this mutation was being run and on every subsequent retry.',
);
const noWait = { sleep: async () => {} };

describe("retryOnConflict", () => {
  it("tries again after a write conflict and returns the result", async () => {
    const fn = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockResolvedValue("saved");
    expect(await retryOnConflict(fn, noWait)).toBe("saved");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last try, and doesn't retry other errors", async () => {
    const always = vi.fn().mockRejectedValue(conflict);
    await expect(retryOnConflict(always, { ...noWait, tries: 3 })).rejects.toBe(conflict);
    expect(always).toHaveBeenCalledTimes(3);

    const other = vi.fn().mockRejectedValue(new Error("Apify dataset 404"));
    await expect(retryOnConflict(other, noWait)).rejects.toThrow("404");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("knows a write conflict by its message", () => {
    expect(isWriteConflict(conflict)).toBe(true);
    expect(isWriteConflict(new Error("Server Error"))).toBe(false);
  });
});
