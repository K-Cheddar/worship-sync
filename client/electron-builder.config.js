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
    // Icon path relative to buildResources directory
    icon: "icon.ico",
    publisherName: "WorshipSync",
    // Critical: This ensures the icon is embedded in the executable
    signAndEditExecutable: true,
  },

  mac: {
    target: ["dmg"],
    icon: "icon.png",
    category: "public.app-category.productivity",
  },

  linux: {
    target: ["AppImage", "deb"],
    icon: "icons",
    category: "Office",
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // NSIS icons are relative to buildResources directory
    installerIcon: "icon.ico",
    uninstallerIcon: "icon.ico",
    installerHeaderIcon: "icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
};

export default config;
