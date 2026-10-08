import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import ConnectShopify from "@/components/ConnectShopify.tsx";
import ShopifyTokenForm from "@/components/ShopifyTokenForm.tsx";

// Settings → Shopify: the connected store (convex/shopifyApp.ts), and the
// message after Shopify sends the merchant back (?shopify=connected|error).
// Stores connected with a token can paste a new one here (e.g. with the
// scopes Full store needs); app installs missing scopes get a Reconnect.
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
        <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Connected to <strong className="text-foreground">{store.shopName}</strong> ({store.shopDomain})
            {store.viaApp ? " through the AdSpy Pro app." : " with an Admin API token from your store's custom app."}
          </p>
          <div className="flex gap-2">
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
        {store.viaApp ? (
          store.missingStoreScopes.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <p className="text-sm">Reconnect once to allow <strong>Full store</strong> (adding a theme, pages and menus to your store).</p>
              <div className="max-w-sm">
                <ConnectShopify />
              </div>
            </div>
          )
        ) : (
          <details className="rounded-lg border border-border p-3 group">
            <summary className="cursor-pointer text-sm font-medium">Update token (needed once for Full store)</summary>
            <div className="mt-3 max-w-md space-y-4">
              {status.appReady && (
                <div className="space-y-2">
                  <p className="text-sm">Easiest: connect through the AdSpy Pro app instead.</p>
                  <ConnectShopify />
                  <p className="text-xs text-muted-foreground">Or paste a new token from your custom app:</p>
                </div>
              )}
              <ShopifyTokenForm shopDomain={store.shopDomain} submitLabel="Save new token" />
            </div>
          </details>
        )}
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
