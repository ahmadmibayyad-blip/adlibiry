import { useState } from "react";
import { Authenticated, useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { FileDown, Settings2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { productCsv, productHandle } from "@/convex/lib/shopifyExport.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";

// One-click Shopify import (convex/shopifyImport.ts): adds the product to the
// user's store as a draft. Without a connected store: connect, or download
// a CSV for Shopify's Products → Import.

const errorText = (e: unknown, fallback: string) =>
  e instanceof ConvexError && typeof (e.data as { message?: unknown })?.message === "string" ? (e.data as { message: string }).message : fallback;

function downloadCsv(product: Doc<"products">) {
  const blob = new Blob([productCsv(product)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${productHandle(product.title)}-shopify.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Connect({ onDone }: { onDone: () => void }) {
  const connect = useAction(api.shopifyImport.connect);
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
        <li>In your Shopify admin go to <strong>Settings → Apps and sales channels → Develop apps</strong> and create an app.</li>
        <li>Under <strong>Configuration → Admin API scopes</strong> tick <code>write_products</code> and save.</li>
        <li>Click <strong>Install app</strong>, then copy the <strong>Admin API access token</strong> (starts with <code>shpat_</code>).</li>
      </ol>
      <Input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" autoComplete="off" />
      <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" type="password" autoComplete="off" />
      <Button
        className="w-full"
        disabled={busy || !shop.trim() || !token.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await connect({ shopDomain: shop, accessToken: token });
            toast.success(`Connected to ${r.shopName}`);
            setToken("");
            onDone();
          } catch (e) {
            toast.error(errorText(e, "Couldn't connect the store"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        Connect store
      </Button>
      <p className="text-[11px] text-muted-foreground">The token is stored on our server and only used to create products in your store. Disconnect any time.</p>
    </div>
  );
}

function AddButton({ product }: { product: Doc<"products"> }) {
  const shop = useQuery(api.shopifyImport.connection, {});
  const push = useAction(api.shopifyImport.pushProduct);
  const disconnect = useMutation(api.shopifyImport.disconnect);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const r = await push({ productId: product._id });
      toast.success("Added to your store as a draft", {
        action: { label: "Open in Shopify", onClick: () => window.open(r.adminUrl, "_blank", "noopener") },
        duration: 10_000,
      });
    } catch (e) {
      toast.error(errorText(e, "Couldn't add the product"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => (shop ? add() : setOpen(true))}>
        {busy ? <Spinner /> : <ShoppingBag className="w-4 h-4 mr-2" />}
        Add to Shopify
      </Button>
      {shop && (
        <Button variant="ghost" size="icon" title="Shopify settings and CSV" onClick={() => setOpen(true)}>
          <Settings2 className="w-4 h-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Shopify</DialogTitle>
            <DialogDescription>
              {shop ? `Connected to ${shop.shopName} (${shop.shopDomain}).` : "Connect your store once, then add products with one click. They arrive as drafts."}
            </DialogDescription>
          </DialogHeader>
          {shop ? (
            <div className="flex flex-col gap-2">
              <Button
                onClick={async () => {
                  setOpen(false);
                  await add();
                }}
              >
                <ShoppingBag className="w-4 h-4 mr-2" />
                Add “{product.title.slice(0, 40)}”
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await disconnect({});
                  toast.success("Store disconnected");
                }}
              >
                Disconnect store
              </Button>
            </div>
          ) : (
            <Connect onDone={() => setOpen(false)} />
          )}
          <div className="border-t border-border pt-3">
            <Button variant="outline" className="w-full" onClick={() => downloadCsv(product)}>
              <FileDown className="w-4 h-4 mr-2" />
              Download Shopify CSV instead
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1.5">Shopify admin → Products → Import → choose this file.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AddToShopify({ product }: { product: Doc<"products"> }) {
  return (
    <Authenticated>
      <AddButton product={product} />
    </Authenticated>
  );
}
