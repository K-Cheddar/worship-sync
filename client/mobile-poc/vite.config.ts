import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const capacitorPackagePath = resolve(directory, "node_modules/@capacitor/core/package.json");
const capacitorVersion = existsSync(capacitorPackagePath)
  ? JSON.parse(readFileSync(capacitorPackagePath, "utf8")).version as string
  : "8.x";

export default defineConfig({
  root: directory,
  plugins: [react()],
  resolve: {
    alias: {
      "@worshipsync": resolve(directory, "../src"),
    },
    dedupe: ["events", "pouchdb-browser", "react", "react-dom"],
  },
  optimizeDeps: {
    include: ["pouchdb-browser", "events"],
    esbuildOptions: { define: { global: "globalThis" } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      input: {
        main: resolve(directory, "index.html"),
        peer: resolve(directory, "peer.html"),
      },
    },
  },
  envPrefix: ["VITE_", "MOBILE_POC_"],
  define: { __CAPACITOR_VERSION__: JSON.stringify(capacitorVersion) },
});
