import { defineConfig } from "electron-builder";

export default defineConfig({
  appId: "com.worshipsync.app",
  productName: "WorshipSync",
  directories: {
    output: "dist",
    buildResources: "buildResources",
  },
  files: [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json",
    "!node_modules"
  ],
  asar: true,
  npmRebuild: false,
  includeSubNodeModules: false,
  buildDependenciesFromSource: false,
  
  // Publish to existing release (not draft)
  releaseInfo: {
    releaseNotes: "",
  },

  win: {
    target: [{ target: "nsis", arch: ["x64", "ia32"] }],
    icon: "buildResources/icon.png",
    publisherName: "WorshipSync",
  },

  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: "buildResources/icon.png",
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
    owner: "K-Cheddar",
    repo: "worship-sync",
    releaseType: "release",
  },
});
