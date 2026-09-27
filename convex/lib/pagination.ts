// Shared manual pagination helper for list queries whose filters can't use a
// Convex index (e.g. price range, minimum score, parsed revenue threshold).
// Convex discourages combining `.filter()` with `.paginate()` because it can
// return partial or empty pages while `isDone` is false. Instead: fetch a
// bounded candidate set, apply every filter first, then slice a page from
// the fully-filtered array using a plain numeric offset encoded as the
// pagination cursor. Correct for the small (low hundreds) datasets each
// caller works with.
export function paginateFilteredArray<T>(
  items: T[],
  opts: { numItems: number; cursor: string | null }
): { page: T[]; isDone: boolean; continueCursor: string } {
  const offset = opts.cursor ? parseInt(opts.cursor, 10) : 0;
  const page = items.slice(offset, offset + opts.numItems);
  const nextOffset = offset + page.length;
  return {
    page,
    isDone: nextOffset >= items.length,
    continueCursor: String(nextOffset),
  };
}
