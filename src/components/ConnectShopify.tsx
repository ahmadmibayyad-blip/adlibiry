import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Connect a store through the AdSpy Pro Shopify app (convex/shopifyApp.ts):
// Shopify asks the merchant to approve, then sends them back to the Launch
// dashboard (/dashboard/launch/shopify-callback).
export default function ConnectShopify() {
  const start = useMutation(api.shopifyApp.startInstall);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { url } = await start({ shop });
          window.location.assign(url);
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't start the connection"));
          setBusy(false);
        }
      }}
    >
      <Input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" autoComplete="off" />
      <Button type="submit" className="w-full" disabled={busy || !shop.trim()}>
        {busy && <Spinner />}
        Connect with Shopify
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Shopify asks you to approve AdSpy Pro, then brings you back. We create products, and for a full store a theme, pages and menus; we never see your
        orders or customers. No store yet?{" "}
        <a className="underline" href="https://www.shopify.com/free-trial" target="_blank" rel="noopener noreferrer">
          Start one on Shopify
        </a>
        .
      </p>
    </form>
  );
}
