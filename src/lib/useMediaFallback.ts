import { useState } from "react";

// Ad media load from the source link first; when it fails (expired CDN link)
// they switch to our own copy (convex/lib/adMedia.ts), if we have one.
// `failed` once neither loads.
export function useMediaFallback(primary: string | undefined, backup: string | undefined) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const first = primary || backup;
  const second = primary && backup && backup !== primary ? backup : undefined;
  const src = step === 0 ? first : step === 1 ? second : undefined;
  const onError = () => setStep((s) => (s === 0 && second ? 1 : 2));
  return { src, onError, failed: !src };
}
