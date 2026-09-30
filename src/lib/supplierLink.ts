// Where a supplier listing's store link goes. A listing saved with only a
// site's homepage opens an AliExpress search for the product instead.
export function supplierLink(s: { supplierUrl: string; title: string }): string {
  try {
    const u = new URL(s.supplierUrl);
    if ((u.pathname !== "" && u.pathname !== "/") || u.search) return s.supplierUrl;
  } catch {
    // Not a valid URL: fall through to a search.
  }
  return `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(s.title.slice(0, 80))}`;
}
