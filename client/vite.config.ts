import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";
import fs from "fs";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    root: ".",
    base: "/",
    build: {
      sourcemap: true,
      outDir: "dist",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
        },
      },
      commonjsOptions: {
        include: [/pouchdb/, /node_modules/],
        transformMixedEsModules: true,
        esmExternals: true,
      },
    },
    optimizeDeps: {
      include: ["pouchdb-browser"],
      force: true,
    },
    plugins: [
      react(),
      sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "worshipsync",
        project: "javascript-react",
      }),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "service-worker.ts",
        injectManifest: {
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB (main bundle ~3 MB)
        },
      }),
    ],
    server: isDev
      ? {
          host: "local.worshipsync.net",
          port: 3001,
          https: {
            key: fs.readFileSync("./local.worshipsync.net-key.pem"),
            cert: fs.readFileSync("./local.worshipsync.net.pem"),
          },
        }
      : undefined,
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
  };
});
