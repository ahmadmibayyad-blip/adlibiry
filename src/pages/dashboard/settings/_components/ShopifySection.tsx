import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";

// Settings → Shopify: the connected store (convex/shopifyApp.ts), and the
// message after Shopify sends the merchant back (?shopify=connected|error).
export default function ShopifySection() {
  const status = useQuery(api.shopifyApp.status, {});
  const disconnect = useMutation(api.shopifyImport.disconnect);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const outcome = params.get("shopify");
    if (!outcome) return;
    if (outcome === "connected") toast.success("Your Shopify store is connected");
    else toast.error(params.get("reason") || "Couldn't connect the store");
    params.delete("shopify");
    params.delete("reason");
    setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- read the return message once

  if (!status) return null;
  const store = status.store;
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShoppingBag className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Shopify</h2>
      </div>
      {store ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Connected to <strong className="text-foreground">{store.shopName}</strong> ({store.shopDomain})
            {store.viaApp ? "" : " with a pasted token. Reconnect through the AdSpy Pro app when it's available."}
          </p>
          <div className="flex gap-2">
            {!store.viaApp && status.appReady && <ConnectShopify />}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await disconnect({});
                toast.success("Store disconnected");
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : status.appReady ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">Connect your store to launch winning products as ready-made product pages.</p>
          <div className="max-w-sm">
            <ConnectShopify />
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Connect a store from any product page with “Add to Shopify”. One-click Launch arrives with the AdSpy Pro Shopify app.</p>
      )}
    </div>
  );
}
