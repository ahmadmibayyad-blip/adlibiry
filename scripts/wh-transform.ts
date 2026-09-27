// Turn a saved WinningHunter result (MCP or REST) into ad/product records.
// Usage: npx tsx scripts/wh-transform.ts <result.json> <out.json>
import { readFileSync, writeFileSync } from "fs";
import { whToRecords } from "../convex/lib/whTransform.ts";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = whToRecords(raw.data ?? []);
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(`ads ${out.ads.length}, products ${out.products.length}, total available ${raw.total}`);
