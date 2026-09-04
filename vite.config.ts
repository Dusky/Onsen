import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The app shell's service worker (SPEC §16).
 *
 * The worker itself is hand-written in `client/sw-template.js`; all this does
 * is fill in the list of files to precache, which is only known once the build
 * has emitted its hashed filenames. Written with `writeBundle` rather than
 * emitted as an asset so it can also pick up what `public/` contributed —
 * the fonts, the icons and the manifest are copied, not bundled.
 *
 * Not registered in dev: a worker that serves a stale shell is exactly the
 * wrong thing to have running while editing one.
 */
function serviceWorker(outDir: string): Plugin {
  return {
    name: "onsen-service-worker",
    apply: "build",
    writeBundle() {
      const files: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
          else files.push(`${prefix}${entry}`);
        }
      };
      walk(outDir, "");

      // The shell, and only the shell: the entry document, the hashed bundles,
      // and the assets the design cannot do without. Not the icons — a launcher
      // reads those once, and precaching them costs the install for nothing.
      const shell = files
        .filter(
          (file) =>
            file === "index.html" ||
            file.startsWith("assets/") ||
            (file.startsWith("fonts/") && !file.endsWith(".md")),
        )
        .map((file) => `/${file}`)
        .sort();
      const precache = ["/", ...shell];

      const template = readFileSync(r("./client/sw-template.js"), "utf8");
      const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);
      const worker = template
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, "sw.js"), worker);
    },
  };
}

// The SPA is served from the same origin as the API in production (SPEC §1), so
// there is no CORS anywhere. In dev, Vite proxies the API to the Bun server.
export default defineConfig({
  root: r("./client"),
  plugins: [react(), tailwindcss(), serviceWorker(r("./dist/client"))],
  resolve: {
    alias: {
      "@shared": r("./shared"),
      "@client": r("./client"),
    },
  },
  build: {
    outDir: r("./dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
