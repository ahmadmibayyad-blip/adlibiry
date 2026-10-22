import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// vercel.json sends every path to the app (app.html) except those its rewrite lists; on Vercel
// that rewrite wins over files in public/, so a public folder or file missing from the list is
// served as the app's HTML (e.g. /actors/maya.jpg, which fal must fetch as a photo).
const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] };
const appRewrite = config.rewrites.find((r) => r.destination === "/app.html");

describe("vercel.json", () => {
  it("serves every public file and folder as itself, not as the app", () => {
    expect(appRewrite).toBeTruthy();
    const pattern = new RegExp(`^${appRewrite!.source}$`);
    for (const name of readdirSync("public").filter((n) => !n.startsWith("."))) {
      const path = statSync(`public/${name}`).isDirectory() ? `/${name}/x` : `/${name}`;
      expect(pattern.test(path), `${path} goes to the app`).toBe(false);
    }
    expect(pattern.test("/dashboard/ad-spy")).toBe(true);
  });

  it("serves /vs/<slug> from the built comparison pages (vite.config.ts comparePages)", () => {
    expect(new RegExp(`^${appRewrite!.source}$`).test("/vs/minea")).toBe(false);
    expect(config.rewrites).toContainEqual({ source: "/vs/:slug", destination: "/vs/:slug.html" });
  });
});
