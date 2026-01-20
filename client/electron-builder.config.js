import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",
  directories: {
    output: "release",
    buildResources: "buildResources",
  },
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json",
    "!node_modules"
  ],
  asar: true,
  includeSubNodeModules: false,
  buildDependenciesFromSource: false,

  win: {
    target: [{ target: "nsis", arch: ["x64", "ia32"] }],
    icon: "icon.png",
    publisherName: "WorshipSync",
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
