import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Plug, Copy, Trash2, KeyRound } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

// The MCP endpoint is served from the Convex HTTP host: same deployment as
// VITE_CONVEX_URL, on ".convex.site" instead of ".convex.cloud".
const SERVER_URL = `${(import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  String(import.meta.env.VITE_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site")}/mcp`;

function copy(text: string, label: string) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error("Couldn't copy. Select the text and copy it by hand."));
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs">{value}</code>
        <Button type="button" size="sm" variant="secondary" onClick={() => copy(value, label)}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function McpSection() {
  const keys = useQuery(api.mcpKeys.listMyKeys, {});
  const createKey = useAction(api.mcpKeys.createKey);
  const revokeKey = useMutation(api.mcpKeys.revokeKey);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    try {
      const r = await createKey({ name: name || "My AI app" });
      setNewKey(r.key);
      setName("");
    } catch (e) {
      toast.error(e instanceof ConvexError ? (e.data as { message?: string }).message ?? "Couldn't create a key" : "Couldn't create a key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Plug className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Connect your AI app (MCP)</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Use AdSpy Pro's winning products and ads inside Claude, ChatGPT, Cursor or any app that supports MCP.
        Create a key, then add AdSpy Pro as a connector in your app. Treat the key like a password.
      </p>

      {newKey ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3 mb-4">
          <p className="text-xs font-medium">Your new key. Copy it now; it won't be shown again.</p>
          <CopyRow label="Connector URL (includes your key)" value={`${SERVER_URL}?key=${newKey}`} />
          <CopyRow label="Key only (for apps that ask for a Bearer token)" value={newKey} />
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">Claude (web or desktop):</strong> Settings → Connectors → Add custom connector,
              and paste the connector URL.
            </p>
            <p>
              <strong className="text-foreground">Claude Code:</strong>{" "}
              <code className="break-all">claude mcp add --transport http adspy-pro {SERVER_URL} --header "Authorization: Bearer {newKey}"</code>
            </p>
            <p>
              <strong className="text-foreground">Other apps:</strong> add a remote MCP server (Streamable HTTP) with the connector URL,
              or with <code>{SERVER_URL}</code> and the key as a Bearer token.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>Done</Button>
        </div>
      ) : (
        <form
          className="flex gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder="Key name, e.g. Claude"
            disabled={busy}
          />
          <Button type="submit" disabled={busy}>
            <KeyRound className="w-3.5 h-3.5 mr-1.5" />
            {busy ? "Creating…" : "Create key"}
          </Button>
        </form>
      )}

      {keys && keys.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {keys.map((k) => (
            <div key={k._id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium truncate">{k.name}</div>
                <div className="text-muted-foreground">
                  <code>{k.prefix}…</code> · created {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}` : " · never used"}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete key ${k.name}`}
                onClick={async () => {
                  if (!window.confirm(`Delete "${k.name}"? Apps using it will stop working.`)) return;
                  try {
                    await revokeKey({ id: k._id });
                    toast.success("Key deleted");
                  } catch {
                    toast.error("Couldn't delete the key");
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
