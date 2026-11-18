import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.worshipsync.mobilepoc",
  appName: "WorshipSync Native Storage PoC",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
