import type { ServicePlanImportSource } from "../../types/servicePlan";

const HIDE_NOTES_STORAGE_KEY = "worshipsyncServicePlanHideNotes";
const IMPORT_SOURCE_STORAGE_KEY = "worshipsyncServicePlanImportSource";
const LAST_USED_TEMPLATE_STORAGE_KEY = "worshipsyncServicePlanLastUsedTemplates";

export type ServicePlanTemplateHistory = Record<string, string>;

const lastUsedTemplateStorageKey = (churchId: string): string =>
  `${LAST_USED_TEMPLATE_STORAGE_KEY}:${encodeURIComponent(churchId)}`;

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

export const readServicePlanTemplateHistory = (
  churchId?: string,
): ServicePlanTemplateHistory => {
  if (!churchId) return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(lastUsedTemplateStorageKey(churchId)) || "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([serviceId, templateId]) =>
          Boolean(serviceId.trim()) &&
          typeof templateId === "string" &&
          Boolean(templateId.trim()),
      ),
    );
  } catch {
    return {};
  }
};

/**
 * Remember the last template without replacing another service type's entry.
 * The church id is part of the key so a shared browser cannot leak template
 * choices between tenants.
 */
export const rememberServicePlanTemplate = (
  churchId: string | undefined,
  serviceId: string,
  templateId: string,
): ServicePlanTemplateHistory => {
  if (!churchId || !serviceId || !templateId) return {};
  const next = {
    ...readServicePlanTemplateHistory(churchId),
    [serviceId]: templateId,
  };
  try {
    window.localStorage.setItem(
      lastUsedTemplateStorageKey(churchId),
      JSON.stringify(next),
    );
  } catch {
    // Storage is optional; the preference still applies for this session.
  }
  return next;
};
