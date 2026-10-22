import { useEffect } from "react";
import { useMutation } from "convex/react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { firstClick, saveReferral } from "@/lib/referral.ts";

// adspypro.net/r/<code>: keep the affiliate's code, count the click, show the home page.
export default function Referral() {
  const { code = "" } = useParams();
  const trackClick = useMutation(api.affiliates.trackClick);
  useEffect(() => {
    if (!code) return;
    saveReferral(code);
    if (firstClick(code.toLowerCase())) trackClick({ code }).catch(() => {});
  }, [code, trackClick]);
  return <Navigate to="/" replace />;
}
