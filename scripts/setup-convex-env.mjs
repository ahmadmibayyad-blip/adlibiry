// Runs on Vercel before `convex deploy` (see vercel.json). Uses the
// CONVEX_DEPLOY_KEY to create Convex environment variables that must exist
// but should never be typed by hand (auth signing keys, webhook secret).
// Only sets values that are missing, so keys are generated once.
// Secrets are sent over HTTPS in a request body — never on a command line,
// and never printed.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const key = process.env.CONVEX_DEPLOY_KEY?.trim();
if (!key) {
  console.log("[setup-convex-env] No CONVEX_DEPLOY_KEY — skipping.");
  process.exit(0);
}

// Deploy keys look like "prod:<deployment-name>|<secret>".
const [target] = key.split("|");
const match = /^(prod|preview|dev):([a-z0-9-]+)$/.exec(target ?? "");
if (!match || !key.includes("|")) {
  console.error(
    "[setup-convex-env] CONVEX_DEPLOY_KEY does not look like a Convex deploy key " +
      `(expected "prod:<deployment>|<secret>", got a value starting with "${(target ?? "").slice(0, 12)}…"). ` +
      "Copy the full key from Convex → Production → Settings → Deploy Keys and paste it again in Vercel.",
  );
  process.exit(1);
}
const deployment = match[2];
const url = process.env.CONVEX_URL_OVERRIDE ?? `https://${deployment}.convex.cloud`;
console.log(`[setup-convex-env] deploy key targets ${match[1]} deployment "${deployment}"`);

async function call(path, body) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { Authorization: `Convex ${key}`, "Content-Type": "application/json", "Convex-Client": "npm-cli-1.46.0" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Names only: `convex env list` prints NAME=value lines to our pipe; values
// are discarded immediately and never logged.
function existingNames() {
  try {
    const out = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["convex", "env", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new Set(out.split("\n").map((l) => l.split("=")[0].trim()).filter(Boolean));
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? "").split("\n").find((l) => l.trim()) ?? "unknown error";
    console.log(`[setup-convex-env] skipped — this deploy key cannot manage env vars (${msg.trim()}).`);
    console.log("[setup-convex-env] Set JWT_PRIVATE_KEY, JWKS and SITE_URL once in Convex → Settings → Environment Variables.");
    process.exit(0);
  }
}

const have = existingNames();
const changes = [];
if (!have || !have.has("JWT_PRIVATE_KEY") || !have.has("JWKS")) {
  if (have && (have.has("JWT_PRIVATE_KEY") || have.has("JWKS"))) {
    console.log("[setup-convex-env] auth keys partially present — leaving them alone");
  } else if (have) {
    const keys = await generateKeyPair("RS256", { extractable: true });
    const privateKey = await exportPKCS8(keys.privateKey);
    const publicKey = await exportJWK(keys.publicKey);
    changes.push({ name: "JWT_PRIVATE_KEY", value: privateKey.trimEnd().replace(/\n/g, " ") });
    changes.push({ name: "JWKS", value: JSON.stringify({ keys: [{ use: "sig", ...publicKey }] }) });
  }
}
const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (prodHost && match[1] === "prod") changes.push({ name: "SITE_URL", value: `https://${prodHost}` });

if (changes.length) {
  try {
    await call("/api/update_environment_variables", { changes });
    console.log(`[setup-convex-env] set ${changes.map((c) => c.name).join(", ")}`);
  } catch (e) {
    console.log(`[setup-convex-env] could not set env vars (${e.message.split("\n")[0]}) — continuing deploy.`);
  }
} else {
  console.log("[setup-convex-env] nothing to change");
}
