import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";
import { COMPARE_PAGES } from "./src/pages/compare/content.ts";
import { compareHtml } from "./src/pages/compare/staticHtml.ts";

// On Vercel the built page is app.html, not index.html: a real file at "/"
// would always win over vercel.json's rewrite, and "/" has to reach
// api/landing.ts (live numbers written into the page). Other paths rewrite to
// app.html. Local builds keep index.html.
const appShellName = (): Plugin => ({
  name: "app-shell-name",
  apply: "build",
  enforce: "post",
  generateBundle(_, bundle) {
    const page = bundle["index.html"];
    if (!process.env.VERCEL || !page) return;
    page.fileName = "app.html";
  },
});

// /vs/<slug> comparison pages as real HTML files (dist/vs/<slug>.html), so
// search engines read their text; vercel.json rewrites /vs/<slug> to them and
// the app takes over in the browser. Runs before appShellName renames the page.
const comparePages = (): Plugin => ({
  name: "compare-pages",
  apply: "build",
  enforce: "post",
  generateBundle(_, bundle) {
    const page = bundle["index.html"];
    if (!page || page.type !== "asset") return;
    const shell = String(page.source);
    for (const p of COMPARE_PAGES) this.emitFile({ type: "asset", fileName: `vs/${p.slug}.html`, source: compareHtml(shell, p) });
  },
});

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), tailwindcss(), comparePages(), appShellName()],
  resolve: {
    alias: {
      "@/convex": path.resolve(import.meta.dirname, "./convex"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
