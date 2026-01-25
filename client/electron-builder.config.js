const config = {
  appId: "com.worshipsync.app",
  productName: "WorshipSync",
  // eslint-disable-next-line no-template-curly-in-string
  artifactName: "WorshipSync-Setup-${version}.${ext}",

  // Configure update server (GitHub Releases)
  publish: {
    provider: "github",
    owner: "K-Cheddar",
    repo: "worship-sync",
  },

  directories: {
    output: "dist",
    buildResources: "buildResources",
  },

  files: [
    "dist-electron/**/*",
    "package.json"
  ],

  // Ensure buildResources (including icons) are available at runtime
  // This is separate from icon embedding - that's handled by win.icon
  extraResources: [
    "buildResources/**/*"
  ],

  asar: true,
  npmRebuild: false,
  buildDependenciesFromSource: false,

  win: {
    target: ["nsis"],
    // Icon path relative to buildResources directory
    icon: "icon.ico",
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
    oneClick: true,
    installerIcon: "icon.ico",
    uninstallerIcon: "icon.ico",
    installerHeaderIcon: "icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
};

export default config;
