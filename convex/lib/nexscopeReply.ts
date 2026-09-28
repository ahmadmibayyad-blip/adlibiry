// Nexscope's docs say each data API returns its own payload directly — e.g.
// TikTok ad search → { errcode, errmsg, data: { items, total_count } } and
// Shopify store query → { total, stores }. But the platform can add an outer
// envelope ({ code, msg, data: <payload> }); the Amazon importer already sees
// one. Reading only the documented path silently gave "0 results" whenever
// the live shape differed, so these helpers accept both.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

// The object (at most a few data/result levels down) that holds `key`.
export function findPayload(json: unknown, key: string): Json | undefined {
  let cur: unknown = json;
  for (let depth = 0; depth < 4 && isObj(cur); depth++) {
    if (key in cur) return cur;
    cur = cur.data ?? cur.result;
  }
  return undefined;
}

// First provider error found at any envelope level (errcode/code other than
// 0/200), or undefined when every level reports success.
export function nestedError(json: unknown): string | undefined {
  let cur: unknown = json;
  for (let depth = 0; depth < 4 && isObj(cur); depth++) {
    const code = cur.errcode ?? cur.code;
    if (code !== undefined && code !== null && code !== 0 && code !== 200 && code !== "0" && code !== "200") {
      return String(cur.errmsg ?? cur.msg ?? cur.message ?? `error ${String(code)}`);
    }
    cur = cur.data ?? cur.result;
  }
  return undefined;
}

// Short description of a reply's shape, for "no results" messages — shows
// what Nexscope actually sent without dumping the whole body.
export function describeReply(json: unknown): string {
  const parts: string[] = [];
  let cur: unknown = json;
  for (let depth = 0; depth < 3 && isObj(cur); depth++) {
    const keys = Object.keys(cur).slice(0, 8).join(", ");
    parts.push(depth === 0 ? `reply {${keys}}` : `data {${keys}}`);
    const msg = cur.errmsg ?? cur.msg ?? cur.message;
    if (typeof msg === "string" && msg && depth === 0) parts.push(`message "${msg.slice(0, 80)}"`);
    cur = cur.data ?? cur.result;
  }
  return parts.join(" · ") || `reply ${JSON.stringify(json).slice(0, 80)}`;
}
