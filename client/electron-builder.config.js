import { prepareVideoTools } from "./scripts/prepare-video-tools.mjs";

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

  protocols: [
    {
      name: "WorshipSync",
      schemes: ["worshipsync"],
    },
  ],

  files: [
    "dist-electron/**/*",
    "package.json"
  ],

  // Ensure buildResources (including icons) are available at runtime
  // This is separate from icon embedding - that's handled by win.icon
  extraResources: [
    {
      from: "buildResources",
      to: "buildResources",
      filter: ["**/*", "!video-tools/**/*"],
    },
  ],

  // Keep native tools outside ASAR. Only Windows x64 bundles the Phase 1 tools.
  beforePack: async (context) => {
    const isX64 = Number(context.arch) === 1 || context.arch?.toString?.() === "x64";
    if (context.electronPlatformName === "win32" && isX64) {
      await prepareVideoTools("win32", "x64");
    }
  },

  asar: true,
  npmRebuild: false,
  buildDependenciesFromSource: false,

  win: {
    target: ["nsis"],
    extraResources: [
      {
        from: "buildResources/video-tools/win32-x64",
        to: "buildResources/video-tools/win32-x64",
        filter: ["**/*"],
      },
    ],
    // Icon path relative to buildResources directory
    icon: "icon.ico",
    // Critical: This ensures the icon is embedded in the executable
    signAndEditExecutable: true,
  },

  mac: {
    target: ["dmg", "zip"],
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
