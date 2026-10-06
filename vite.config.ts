import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

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
  plugins: [react(), tailwindcss(), appShellName()],
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
