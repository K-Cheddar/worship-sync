import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "local.worshipsync.net",
    port: 3000,
    https: {
      key: fs.readFileSync("./local.worshipsync.net-key.pem"),
      cert: fs.readFileSync("./local.worshipsync.net.pem"),
    },
  },
});
