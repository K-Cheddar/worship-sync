type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "worshipsync.home-descriptions.v1";

const getStorage = (storage?: PreferenceStorage): PreferenceStorage | null => {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readHomeDescriptionsPreference = (
  storage?: PreferenceStorage,
): boolean => {
  const availableStorage = getStorage(storage);
  if (!availableStorage) return true;
  try {
    return availableStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

export const writeHomeDescriptionsPreference = (
  showDescriptions: boolean,
  storage?: PreferenceStorage,
): boolean => {
  const availableStorage = getStorage(storage);
  if (!availableStorage) return false;
  try {
    availableStorage.setItem(STORAGE_KEY, String(showDescriptions));
    return true;
  } catch {
    return false;
  }
};
