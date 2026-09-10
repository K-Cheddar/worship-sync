import type { ServicePlanImportSource } from "../../types/servicePlan";

const HIDE_NOTES_STORAGE_KEY = "worshipsyncServicePlanHideNotes";
const IMPORT_SOURCE_STORAGE_KEY = "worshipsyncServicePlanImportSource";

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

export const readServicePlanImportSource = (): ServicePlanImportSource => {
  try {
    const stored = window.localStorage.getItem(IMPORT_SOURCE_STORAGE_KEY);
    if (
      stored === "planningCenterPdf" ||
      stored === "planningCenter" ||
      stored === "servicePlanning"
    ) {
      return stored;
    }
  } catch {
    // Storage is optional; fall back to Service Planning.
  }
  return "servicePlanning";
};

export const writeServicePlanImportSource = (
  source: ServicePlanImportSource,
): void => {
  try {
    window.localStorage.setItem(IMPORT_SOURCE_STORAGE_KEY, source);
  } catch {
    // Storage is optional; the preference still applies for this session.
  }
};
