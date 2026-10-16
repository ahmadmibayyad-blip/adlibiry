// Store Inspector → when the store's domain was registered: RDAP (the registries' JSON service, through rdap.org)
// for .com and most domains, and the older whois service for country domains without RDAP (.se, .dk, .no, …).
// Pure: domainInfo.ts asks the servers.

export type DomainAge = { domain: string; registered: string; registrar?: string; source: "rdap" | "whois" };

// Second-level suffixes where the registrable domain has three labels (shop.brand.co.uk → brand.co.uk).
const TWO_PART = new Set(["co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "net.nz", "com.br", "com.mx", "co.za", "com.tr", "co.jp", "com.sg", "com.my", "co.in", "com.cn", "com.hk", "com.ar", "com.co"]);

/** The domain someone registered for this host ("www.shop.brand.co.uk" → "brand.co.uk"). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return labels.slice(TWO_PART.has(lastTwo) ? -3 : -2).join(".");
}

/** Whois servers for country domains that have no RDAP service; null = ask RDAP. */
export const WHOIS_SERVERS: Record<string, string> = {
  se: "whois.iis.se",
  nu: "whois.iis.nu",
  dk: "whois.punktum.dk",
  no: "whois.norid.no",
  fi: "whois.fi",
  uk: "whois.nic.uk",
  nl: "whois.domain-registry.nl",
  be: "whois.dns.be",
  it: "whois.nic.it",
  es: "whois.nic.es",
  at: "whois.nic.at",
  ch: "whois.nic.ch",
  eu: "whois.eu",
};
export const whoisServer = (domain: string) => WHOIS_SERVERS[domain.split(".").pop() ?? ""] ?? null;

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "2023-10-28", "2023-10-28T12:00:00Z", "28-Oct-2023", "28.10.2023", "28/10/2023" → "2023-10-28". */
export function isoDay(raw: string): string | undefined {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

/** The registration date in a whois answer: its "created:" / "Registered:" / "Registered on:" line. */
export function fromWhois(text: string, domain: string): DomainAge | null {
  const created = text.match(/^\s*(?:created|registered(?: on)?|creation date|domain record activated|registration date)\s*[.:]+\s*(.+)$/im)?.[1];
  const registered = created ? isoDay(created) : undefined;
  if (!registered) return null;
  const registrar = text.match(/^\s*registrar(?: name)?\s*[.:]+\s*(.+)$/im)?.[1]?.trim();
  return { domain, registered, ...(registrar && !/^REG\d|handle/i.test(registrar) ? { registrar: registrar.slice(0, 80) } : {}), source: "whois" };
}

/** The registration date in an RDAP answer (events[].eventAction "registration"). */
export function fromRdap(body: unknown, domain: string): DomainAge | null {
  const b = body as { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: unknown[] }[] } | null;
  const date = b?.events?.find((e) => e.eventAction === "registration")?.eventDate;
  const registered = date ? isoDay(date) : undefined;
  if (!registered) return null;
  // The registrar's name sits in its vCard: ["vcard", [["fn", {}, "text", "Name"], …]].
  const card = b?.entities?.find((e) => e.roles?.includes("registrar"))?.vcardArray?.[1];
  const fn = Array.isArray(card) ? (card.find((f) => Array.isArray(f) && f[0] === "fn") as unknown[] | undefined)?.[3] : undefined;
  return { domain, registered, ...(typeof fn === "string" && fn ? { registrar: fn.slice(0, 80) } : {}), source: "rdap" };
}

/** "registered 8 Jul 2026 (3 months ago)". */
export function registeredLabel(d: DomainAge, now = Date.now()): string {
  const at = Date.parse(d.registered);
  const months = Math.max(0, Math.floor((now - at) / (30.44 * 86_400_000)));
  const ago = months < 1 ? "this month" : months < 24 ? `${months} month${months === 1 ? "" : "s"} ago` : `${Math.floor(months / 12)} years ago`;
  const [y, m, day] = d.registered.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `Domain registered ${Number(day)} ${month} ${y} (${ago})`;
}
