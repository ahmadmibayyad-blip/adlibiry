import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { MailX } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";

// The unsubscribe link in every morning digest (no sign-in needed).
export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const unsubscribe = useMutation(api.digest.unsubscribe);
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const token = params.get("token") ?? "";

  useEffect(() => {
    unsubscribe({ token })
      .then((r) => setState(r.ok ? "done" : "invalid"))
      .catch(() => setState("invalid"));
  }, [token, unsubscribe]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <MailX className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">
          {state === "working" ? "Unsubscribing…" : state === "done" ? "You're unsubscribed" : "This link isn't valid any more"}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {state === "done"
            ? "You won't get the morning digest any more. You can turn it back on in Settings."
            : state === "invalid"
              ? "Turn the morning digest off in Settings instead."
              : " "}
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboard/settings">Open Settings</Link>
        </Button>
      </div>
    </div>
  );
}
