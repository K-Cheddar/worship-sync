import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",

  directories: {
    output: "client/dist",
    buildResources: "client/buildResources",
  },

  files: [
    "client/dist/**/*",
    "client/dist-electron/**/*",
    "client/package.json"
  ],

  asar: true,
  npmRebuild: false,
  buildDependenciesFromSource: false,

  win: {
    target: [{ target: "nsis", arch: ["x64", "ia32"] }],
    icon: "client/buildResources/icon.ico",
    publisherName: "WorshipSync",
  },

  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: "client/buildResources/icons",
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },

});
