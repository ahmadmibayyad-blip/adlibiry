import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";

// Connect (or update) a store with a custom-app Admin API token
// (convex/shopifyImport.ts connect), for stores without the AdSpy Pro Shopify
// app. Custom apps only exist in stores that created one before Shopify ended
// them in 2026. The scopes cover Add to Shopify, Launch and Full store.

const TOKEN_SCOPES = ["write_products", "write_publications", "write_themes", "write_online_store_pages", "write_online_store_navigation"];

export default function ShopifyTokenForm({ shopDomain, onDone, submitLabel = "Connect store" }: { shopDomain?: string; onDone?: () => void; submitLabel?: string }) {
  const connect = useAction(api.shopifyImport.connect);
  const [shop, setShop] = useState(shopDomain ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
        <li>
          In your Shopify admin go to <strong>Settings → Apps and sales channels → Develop apps</strong> and open your app (or create one).
        </li>
        <li>
          Under <strong>Configuration → Admin API integration → Edit</strong> tick these scopes and save:{" "}
          {TOKEN_SCOPES.map((s, i) => (
            <span key={s}>
              <code className="text-foreground">{s}</code>
              {i < TOKEN_SCOPES.length - 1 ? ", " : ""}
            </span>
          ))}
          .
        </li>
        <li>
          Under <strong>API credentials</strong> click <strong>Install app</strong> (or <strong>Update</strong>), then reveal and copy the <strong>Admin API access token</strong> (starts with{" "}
          <code>shpat_</code>). Shopify shows it only once; if it's hidden, uninstall and install the app again to get a new one.
        </li>
      </ol>
      <Input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" autoComplete="off" aria-label="Store address" />
      <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" type="password" autoComplete="off" aria-label="Admin API access token" />
      <Button
        className="w-full"
        disabled={busy || !shop.trim() || !token.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await connect({ shopDomain: shop, accessToken: token });
            toast.success(`Connected to ${r.shopName}`);
            setToken("");
            onDone?.();
          } catch (e) {
            toast.error(errorMessage(e, "Couldn't connect the store"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        {submitLabel}
      </Button>
      <p className="text-[11px] text-muted-foreground">The token is stored on our server and only used to create products, pages and themes in your store. Disconnect any time.</p>
    </div>
  );
}
