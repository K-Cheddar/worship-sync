const config = {
  appId: "com.worshipsync.app",
  productName: "WorshipSync",

  directories: {
    output: "dist",
    buildResources: "buildResources",
  },

  files: [
    "dist-electron/**/*",
    "package.json"
  ],

  asar: true,
  npmRebuild: false,
  buildDependenciesFromSource: false,

  win: {
    target: ["nsis"],
    icon: "buildResources/icon.ico",   // correct Windows icon
    publisherName: "WorshipSync",
  },

  linux: {
    target: ["AppImage", "deb"],
    icon: "buildResources/icons",      // folder with PNGs
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
};

export default config;

