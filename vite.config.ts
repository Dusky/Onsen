import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The SPA is served from the same origin as the API in production (SPEC §1), so
// there is no CORS anywhere. In dev, Vite proxies the API to the Bun server.
export default defineConfig({
  root: r("./client"),
  plugins: [react(), tailwindcss()],
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
