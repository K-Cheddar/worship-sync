import { defineConfig } from "vite";
import { resolve } from "path";

// Vite config for building Electron main and preload scripts
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
  build: {
    outDir: "dist-electron",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "electron/main.ts"),
        preload: resolve(__dirname, "electron/preload.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "es",
      },
      external: [
        "electron",
        /^node:/,
        "path",
        "url",
        "fs",
        "fs/promises",
      ],
    },
    target: "node18",
    minify: false,
    treeshake: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
