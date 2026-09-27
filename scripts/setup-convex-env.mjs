// Runs on Vercel before `convex deploy` (see vercel.json). Uses the
// CONVEX_DEPLOY_KEY to set Convex environment variables that must exist
// but should never be typed by hand. Only sets values that are missing, so
// keys are generated once and never rotated by accident.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log("[setup-convex-env] No CONVEX_DEPLOY_KEY — skipping.");
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args) => execFileSync(npx, ["convex", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function get(name) {
  try {
    return run(["env", "get", name]).trim();
  } catch {
    return "";
  }
}
function set(name, value) {
  run(["env", "set", name, "--", value]);
  console.log(`[setup-convex-env] set ${name}`);
}

if (!get("JWT_PRIVATE_KEY") || !get("JWKS")) {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = await exportPKCS8(keys.privateKey);
  const publicKey = await exportJWK(keys.publicKey);
  set("JWT_PRIVATE_KEY", privateKey.trimEnd().replace(/\n/g, " "));
  set("JWKS", JSON.stringify({ keys: [{ use: "sig", ...publicKey }] }));
}

const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (prodHost && get("SITE_URL") !== `https://${prodHost}`) set("SITE_URL", `https://${prodHost}`);

if (!get("APIFY_WEBHOOK_SECRET")) set("APIFY_WEBHOOK_SECRET", randomBytes(24).toString("hex"));

console.log("[setup-convex-env] done");
