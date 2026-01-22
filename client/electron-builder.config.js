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
    icon: "icon.ico", // relative to buildResources
    publisherName: "WorshipSync",
  },

  mac: {
    target: ["dmg"],
    icon: "icon.png", // relative to buildResources
    category: "public.app-category.productivity",
  },

  linux: {
    target: ["AppImage", "deb"],
    icon: "icons", // folder relative to buildResources
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "icon.ico",
    uninstallerIcon: "icon.ico",
    installerHeaderIcon: "icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
};

export default config;
