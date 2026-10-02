// The picture shown for a store. Stores added by product discovery only have
// a site icon (blurry when enlarged), so they show their best-seller photo.
export function storeImage(store: { logoUrl: string; bestSellers: { imageUrl: string }[] }): string {
  const icon = !store.logoUrl || store.logoUrl.includes("google.com/s2/favicons");
  return (icon && store.bestSellers.find((b) => b.imageUrl)?.imageUrl) || store.logoUrl;
}
