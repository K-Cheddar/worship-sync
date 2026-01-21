import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",

  publish: {
    provider: "github",
    owner: "K-Cheddar",
    repo: "worship-sync",
    releaseType: "release"
  },

  directories: {
    output: "release",
    buildResources: "buildResources",
  },

  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json"
  ],

  asar: true,
  npmRebuild: false,
  buildDependenciesFromSource: false,

  win: {
    target: [{ target: "nsis", arch: ["x64", "ia32"] }],
    icon: "buildResources/icon.ico",
    publisherName: "WorshipSync",
  },

  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: "buildResources/icons",
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },

});
