// Signed CDN links carry their own expiry time; once it has passed the CDN answers 403.
// Facebook (fbcdn): oe=<hex unix seconds>. TikTok: x-expires=<unix seconds> or sign=<unix seconds>-<hash>.
export function imageLinkExpiry(url: string): number | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const oe = params.get("oe");
  if (oe && /^[0-9a-f]{8}$/i.test(oe)) return parseInt(oe, 16) * 1000;
  const expires = params.get("x-expires");
  if (expires && /^\d{10}$/.test(expires)) return Number(expires) * 1000;
  const sign = params.get("sign")?.match(/^(\d{10})-/);
  if (sign) return Number(sign[1]) * 1000;
  return null;
}

export function imageLinkExpired(url: string, now = Date.now()): boolean {
  const expiry = imageLinkExpiry(url);
  return expiry !== null && expiry < now;
}
