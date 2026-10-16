"use node";

import net from "node:net";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { fromRdap, fromWhois, registrableDomain, whoisServer, type DomainAge } from "./lib/domainAge";

// When a store's domain was registered (lib/domainAge.ts), for Store Inspector: RDAP over HTTPS, or whois
// (a plain text reply on port 43, hence Node) for country domains without RDAP. Null when neither answers.
// DOMAIN_LOOKUPS=off turns it off (the tests do: they never reach the internet).

function whois(server: string, query: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    const socket = net.connect(43, server, () => socket.write(`${query}\r\n`));
    socket.setTimeout(10_000, () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("data", (d) => {
      out += d.toString("utf8");
      if (out.length > 100_000) socket.destroy();
    });
    socket.on("end", () => resolve(out));
    socket.on("close", () => resolve(out || null));
    socket.on("error", () => resolve(null));
  });
}

export const registered = internalAction({
  args: { host: v.string() },
  handler: async (_ctx, args): Promise<DomainAge | null> => {
    if (process.env.DOMAIN_LOOKUPS === "off") return null;
    const domain = registrableDomain(args.host);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
    const server = whoisServer(domain);
    if (server) {
      const text = await whois(server, domain);
      return text ? fromWhois(text, domain) : null;
    }
    // The registry's own RDAP server from IANA's list, else rdap.org (which blocks clients without a name).
    const base = await rdapBase(domain.split(".").pop() ?? "");
    for (const url of [...(base ? [`${base}domain/${domain}`] : []), `https://rdap.org/domain/${domain}`]) {
      try {
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
        const found = res.ok ? fromRdap(await res.json().catch(() => null), domain) : null;
        if (found) return found;
      } catch {
        // try the next one
      }
    }
    return null;
  },
});

const HEADERS = { Accept: "application/rdap+json", "User-Agent": "AdSpyPro/1.0 (+https://adspypro.net)" };
let bootstrap: { at: number; services: [string[], string[]][] } | null = null;

/** The RDAP server for a top-level domain, from IANA's bootstrap file (kept for a day per running instance). */
async function rdapBase(tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > 86_400_000) {
    try {
      const res = await fetch("https://data.iana.org/rdap/dns.json", { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json()) as { services?: [string[], string[]][] };
      if (Array.isArray(body.services)) bootstrap = { at: Date.now(), services: body.services };
    } catch {
      return null;
    }
  }
  const url = bootstrap?.services.find(([tlds]) => tlds.includes(tld))?.[1][0];
  return url ? (url.endsWith("/") ? url : `${url}/`) : null;
}
