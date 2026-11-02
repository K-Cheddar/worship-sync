/** Durable import contract. PDF positions and proposed matches are deliberately
 * absent: they belong to one review, never to an item's persistent identity. */
export type ServicePlanImportSource = "servicePlanning" | "planningCenterPdf" | "planningCenter" | "worshipSync";
export type ServicePlanSourceImport = {
  source: ServicePlanImportSource;
  sourceUrl: string;
  loadedAt: string;
  planLabel: string;
  planningCenterServiceTypeId?: string;
  planningCenterPlanId?: string;
};
export type ServicePlanningSourceSnapshot = {
  elementType: string;
  title: string;
  ledBy: string;
  note: string;
};
export type ServicePlanImportSourceState = {
  observed: ServicePlanningSourceSnapshot;
  applied: ServicePlanningSourceSnapshot;
  pendingFields: Array<keyof ServicePlanningSourceSnapshot>;
  managedAssignees?: Array<{
    id: string;
    fields: Array<"title" | "ledBy">;
    ledByIdentity?: string;
    fingerprint: string;
  }>;
  managedNotes?: Array<{ id: string; fingerprint: string }>;
};

const record = (raw: unknown): Record<string, unknown> | undefined =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
const text = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.trim().slice(0, max) : "";
const array = (raw: unknown): unknown[] => Array.isArray(raw) ? raw : [];

export const normalizeServicePlanSourceImport = (raw: unknown): ServicePlanSourceImport | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const sources: ServicePlanImportSource[] = ["servicePlanning", "planningCenterPdf", "planningCenter", "worshipSync"];
  const source = sources.find((source) => source === value.source) || "servicePlanning";
  const serviceTypeId = text(value.planningCenterServiceTypeId, 160);
  const planId = text(value.planningCenterPlanId, 160);
  return {
    source,
    sourceUrl: text(value.sourceUrl, 2000),
    loadedAt: text(value.loadedAt, 60),
    planLabel: text(value.planLabel, 200),
    ...(serviceTypeId ? { planningCenterServiceTypeId: serviceTypeId } : {}),
    ...(planId ? { planningCenterPlanId: planId } : {}),
  };
};

/** Accept legacy title/duration evidence without treating source position as ID. */
export const normalizePlanningCenterPdfMatchKey = (raw: unknown): string | undefined => {
  if (typeof raw !== "string" || raw.length > 2000) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value[0] !== "planningCenterPdf" || typeof value[1] !== "string" || !value[1].trim()) return undefined;
    if (value.length === 3 && value[2] === "single") return raw;
    if (value.length === 5 && value[2] === "duplicate" &&
      Number.isFinite(value[3]) && value[3] >= 0 && Number.isSafeInteger(value[4]) && value[4] >= 0) return raw;
  } catch { /* Invalid metadata supplies no identity evidence. */ }
  return undefined;
};

export const normalizeServicePlanImportSourceState = (raw: unknown): ServicePlanImportSourceState | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const snapshot = (raw: unknown): ServicePlanningSourceSnapshot | undefined => {
    const value = record(raw);
    return value ? { elementType: text(value.elementType, 200), title: text(value.title, 2000), ledBy: text(value.ledBy, 2000), note: text(value.note, 2000) } : undefined;
  };
  const observed = snapshot(value.observed);
  const applied = snapshot(value.applied);
  if (!observed || !applied) return undefined;
  const fields: Array<keyof ServicePlanningSourceSnapshot> = ["elementType", "title", "ledBy", "note"];
  const pendingFields = fields.filter((field) => array(value.pendingFields).includes(field));
  const managedNotes = array(value.managedNotes).slice(0, 200).flatMap((raw) => {
    const entry = record(raw);
    const id = text(entry?.id, 160);
    const fingerprint = text(entry?.fingerprint, 10000);
    return id && fingerprint ? [{ id, fingerprint }] : [];
  });
  const managedAssignees = array(value.managedAssignees).slice(0, 200).flatMap((raw) => {
    const entry = record(raw);
    const id = text(entry?.id, 160);
    const fingerprint = text(entry?.fingerprint, 10000);
    const fields = (["title", "ledBy"] as const).filter((field) => array(entry?.fields).includes(field));
    const ledByIdentity = text(entry?.ledByIdentity, 160);
    return id && fingerprint && fields.length
      ? [{ id, fingerprint, fields, ...(ledByIdentity ? { ledByIdentity } : {}) }] : [];
  });
  return { observed, applied, pendingFields,
    ...(managedNotes.length ? { managedNotes } : {}),
    ...(managedAssignees.length ? { managedAssignees } : {}),
  };
};
