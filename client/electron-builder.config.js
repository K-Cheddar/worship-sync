import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json",
    "!node_modules/**/*",
    "!src/**/*",
    "!electron/**/*",
    "!*.config.js",
    "!*.config.ts",
  ],
  extraResources: [
    {
      from: "dist",
      to: "app/dist",
      filter: ["**/*"],
    },
  ],
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64", "ia32"],
      },
    ],
    icon: "public/WorshipSyncIcon.png",
    publisherName: "WorshipSync",
  },
  mac: {
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
    ],
    icon: "public/WorshipSyncIcon.png",
    category: "public.app-category.productivity",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
  linux: {
    target: [
      {
        target: "AppImage",
        arch: ["x64"],
      },
      {
        target: "deb",
        arch: ["x64"],
      },
    ],
    icon: "public/WorshipSyncIcon.png",
    category: "Office",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  publish: {
    provider: "github",
    releaseType: "release",
  },
});
