import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolve } from "path";
import fs from "fs";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const isElectronBuild = process.env.ELECTRON_BUILD === "true";

  return {
    build: {
      sourcemap: true,
      // For Electron, we need to use relative paths
      base: isElectronBuild ? "./" : "/",
    },
    plugins: [
      react(),
      sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "worshipsync",
        project: "javascript-react",
      }),
    ],
    base: "/",
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
