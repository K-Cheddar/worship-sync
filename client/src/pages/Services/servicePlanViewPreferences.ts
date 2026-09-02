const HIDE_NOTES_STORAGE_KEY = "worshipsyncServicePlanHideNotes";

export const readServicePlanHideNotes = (): boolean => {
  try {
    return window.localStorage.getItem(HIDE_NOTES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeServicePlanHideNotes = (hideNotes: boolean): void => {
  try {
    if (hideNotes) {
      window.localStorage.setItem(HIDE_NOTES_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(HIDE_NOTES_STORAGE_KEY);
    }
  } catch {
    // Storage is optional; the preference still applies for this session.
  }
};
