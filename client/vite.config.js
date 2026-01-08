import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import fs from "fs";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    plugins: [react()],
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