import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Gauge, Monitor, Smartphone } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { speedBand, type SpeedRun } from "@/convex/lib/pageSpeed.ts";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { errorMessage } from "@/lib/errorMessage.ts";
import { cn } from "@/lib/utils.ts";

// Store Inspector → Speed (convex/storeSpeed.ts): Google PageSpeed for the store's home page on a phone and a
// desktop, on request (each takes 20-40 s), next to the user's own store when they ask.

type Speed = FunctionReturnType<typeof api.storeSpeed.check>;
const BAND = { good: "text-good", ok: "text-warn", poor: "text-destructive" } as const;
const REAL = { FAST: "fast", AVERAGE: "average", SLOW: "slow" } as Record<string, string>;

function Run({ label, icon: Icon, run }: { label: string; icon: typeof Monitor; run: SpeedRun | null }) {
  if (!run) return <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}: couldn't test</div>;
  return (
    <div className="text-xs space-y-0.5">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        {label}: <span className={cn("text-sm font-semibold", BAND[speedBand(run.score)])}>{run.score}</span>
        <span className="text-muted-foreground">/ 100</span>
      </div>
      <div className="text-muted-foreground">
        {run.lcp !== undefined ? `Main content in ${run.lcp} s` : ""}
        {run.realUsers && REAL[run.realUsers] ? ` · real visitors: ${REAL[run.realUsers]}` : ""}
      </div>
    </div>
  );
}

function Result({ title, speed }: { title: string; speed: Speed }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 min-w-0">
      <div className="text-sm font-medium truncate">{title}</div>
      <Run label="Phone" icon={Smartphone} run={speed.mobile} />
      <Run label="Desktop" icon={Monitor} run={speed.desktop} />
    </div>
  );
}

export default function StoreSpeedSection({ host }: { host: string }) {
  const check = useAction(api.storeSpeed.check);
  const mine = useQuery(api.storeSpeed.myStore, {});
  const [theirs, setTheirs] = useState<Speed | null>(null);
  const [ours, setOurs] = useState<Speed | null>(null);
  const [busy, setBusy] = useState<"theirs" | "ours" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (which: "theirs" | "ours") => {
    const target = which === "theirs" ? host : mine?.host;
    if (!target) return;
    setBusy(which);
    setError(null);
    try {
      const r = await check({ host: target });
      if (which === "theirs") setTheirs(r);
      else setOurs(r);
    } catch (e) {
      setError(errorMessage(e, "The speed test didn't work"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Gauge className="w-3.5 h-3.5" />Speed
      </h4>
      {!theirs && busy !== "theirs" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void run("theirs")}>
            <Gauge className="w-4 h-4 mr-1.5" /> Check speed
          </Button>
          <span className="text-xs text-muted-foreground">Google PageSpeed on a phone and a desktop. Slow stores lose buyers; about 30 seconds.</span>
        </div>
      ) : null}
      {busy ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="w-4 h-4" /> Google is loading the store…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {theirs ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Result title={host} speed={theirs} />
          {ours ? <Result title={`Your store (${mine?.name ?? "connected"})`} speed={ours} /> : mine && busy !== "ours" ? (
            <div className="rounded-lg border border-dashed border-border p-3 grid place-items-center">
              <Button size="sm" variant="ghost" onClick={() => void run("ours")}>Compare with my store</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {theirs ? <p className="text-xs text-muted-foreground">Score 90+ is good, 50–89 needs work, under 50 is slow. "Real visitors" is what Chrome users actually got, when Google has enough of them.</p> : null}
    </section>
  );
}
