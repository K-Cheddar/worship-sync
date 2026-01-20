import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: ["dist", "dist-electron", "package.json"],
  asar: true,

  win: {
    target: [{ target: "nsis", arch: ["x64", "ia32"] }],
    icon: "icon.png",
    publisherName: "WorshipSync",
  },

  mac: {
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] }
    ],
    icon: "icon.png",
    category: "public.app-category.productivity",
  },

  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: "icon.png",
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },

  publish: [
    {
      provider: "github",
      owner: "K-Cheddar",
      repo: "worship-sync",
    },
  ],
});
