import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolve } from "path";
import fs from "fs";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    main: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, "electron/main.ts"),
          },
        },
        outDir: "dist-electron/main",
      },
    },
    preload: {
      build: {
        rollupOptions: {
          input: {
            preload: resolve(__dirname, "electron/preload.ts"),
          },
        },
        outDir: "dist-electron/preload",
      },
    },
    renderer: {
      root: ".", // Custom root since index.html is at project root, not in src/renderer
      plugins: [
        react(),
        sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: "worshipsync",
          project: "javascript-react",
        }),
      ],
      resolve: {
        alias: {
          "@/": resolve(__dirname, "./src"),
          "@/utils": resolve(__dirname, "./src/utils"),
          "@/components": resolve(__dirname, "./src/components"),
          "@/containers": resolve(__dirname, "./src/containers"),
          "@/pages": resolve(__dirname, "./src/pages"),
          "@/context": resolve(__dirname, "./src/context"),
          "@/hooks": resolve(__dirname, "./src/hooks"),
        },
      },
      server: isDev
        ? {
            host: "local.worshipsync.net",
            port: 3000,
            https: {
              key: fs.readFileSync("./local.worshipsync.net-key.pem"),
              cert: fs.readFileSync("./local.worshipsync.net.pem"),
            },
          }
        : undefined,
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, "index.html"),
          },
        },
        sourcemap: true,
        outDir: "dist-electron/renderer",
      },
    },
  };
});
