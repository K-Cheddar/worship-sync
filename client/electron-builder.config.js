const config = {
  appId: "com.worshipsync.app",
  productName: "WorshipSync",

  directories: {
    output: "dist",
    buildResources: "buildResources", // Icons are relative to this directory
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
    icon: "icon.ico",   // Path relative to buildResources directory
    publisherName: "WorshipSync",
  },

  mac: {
    target: ["dmg"],
    icon: "icon.png",   // Path relative to buildResources. For better quality, use .icns format
    category: "public.app-category.productivity",
  },

  linux: {
    target: ["AppImage", "deb"],
    icon: "icons",      // Path relative to buildResources directory
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

