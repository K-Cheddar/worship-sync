export type NativeRuntimeCheck = {
  platform: string;
  isNative: boolean;
  sqlitePluginAvailable: boolean;
};

export const requireNativeSqliteRuntime = ({ platform, isNative, sqlitePluginAvailable }: NativeRuntimeCheck) => {
  if (!isNative || (platform !== "android" && platform !== "ios")) {
    throw new Error("Native SQLite is unavailable. Install and open this proof of concept in the Capacitor Android or iOS app.");
  }
  if (!sqlitePluginAvailable) {
    throw new Error("cordova-sqlite-storage did not register window.sqlitePlugin.openDatabase. Refusing to use WebSQL or IndexedDB.");
  }
};
