import { isDeepStrictEqual } from "node:util";
import { E2E_CHURCH_ID } from "./testChurch";

export const SCHEDULING_OWNER = "scheduling-v1";
export type SchedulingScope = {
  churchId: string; teamId: string; fixtureId: string; runId: string;
  positionId: string; memberId: string; serviceIds: string[]; scheduleId: string;
  startDate: string; endDate: string;
};

export function assertSchedulingIdentity(auth: any) {
  if (auth?.sessionKind !== "human" || !auth.user?.uid) {
    throw new Error("The saved authenticated server session is missing or expired; no scheduling fixtures were changed.");
  }
  if (auth.churchId !== E2E_CHURCH_ID) {
    throw new Error(`The authenticated account belongs to church ${String(auth.churchId || "unknown")}; only church ${E2E_CHURCH_ID} is authorized for E2E scheduling.`);
  }
  return auth.user.uid as string;
}

export function assertSchedulingTeamPermission(auth: any, teamId: string) {
  if (auth?.role !== "admin" && auth?.permissions?.teams !== "edit" && auth?.permissions?.teamScopes?.[teamId] !== "edit") {
    throw new Error(`The authenticated account needs edit access to reserved E2E team ${teamId}; no scheduling fixtures were changed.`);
  }
}

export function assertSchedulingRecoveryManifest(recovery: any, userId: string, scope: SchedulingScope) {
  if (recovery?.scope?.churchId !== E2E_CHURCH_ID) {
    throw new Error(`Recovery manifest church ID must be ${E2E_CHURCH_ID}; preserved all records`);
  }
  if (recovery.owner !== SCHEDULING_OWNER || recovery.userId !== userId ||
      !/^[0-9a-f-]{36}$/.test(recovery.scope?.runId || "") ||
      !isDeepStrictEqual({ ...recovery.scope, runId: "" }, { ...scope, runId: "" }) ||
      !Number.isFinite(Date.parse(recovery.startedAt)) || !/^[0-9a-f]{64}$/.test(recovery.baselineHash || "") ||
      !Array.isArray(recovery.events)) {
    throw new Error("Recovery manifest identity or baseline is invalid; preserved all records");
  }
}

export function assertOwnedRecord(record: any, scope: SchedulingScope, id: string, runOwned = false) {
  const marker = record?.e2eFixture;
  if (record?.churchId !== scope.churchId || record?.teamId !== scope.teamId ||
      marker?.owner !== SCHEDULING_OWNER || marker?.fixtureId !== scope.fixtureId ||
      (runOwned && marker?.runId !== scope.runId)) {
    throw new Error(`Preserved ${id}: test ownership could not be verified for ${scope.churchId}/${scope.teamId}/${scope.runId}`);
  }
}
export function assertSafeSchedule(record: any, scope: SchedulingScope) {
  assertOwnedRecord(record, scope, scope.scheduleId, true);
  const known = (ids: unknown) => Array.isArray(ids) && ids.every(id => scope.serviceIds.includes(id));
  if (record.scheduleId !== scope.scheduleId || record.published !== false || record.sentAt ||
      record.publicLinkToken || record.publicToken || record.guests?.length ||
      record.notificationHistory?.length || record.publicationHistory?.length ||
      !known(record.serviceIds) || !record.occurrences?.every((row: any) =>
        known(row.serviceIds?.length ? row.serviceIds : [row.serviceId]))) {
    throw new Error(`Preserved ${scope.scheduleId}: schedule was published, communicated, or references unowned data`);
  }
  for (const slots of Object.values(record.assignments || {}) as any[]) {
    for (const [slot, value] of Object.entries(slots) as [string, any][]) {
      const members = typeof value === "string" ? [value] : [value?.primaryMemberId, ...(value?.shadows || []).map((shadow: any) => shadow.memberId)];
      if (!slot.startsWith(`${scope.positionId}::`) || members.some(id => id && id !== scope.memberId)) {
        throw new Error(`Preserved ${scope.scheduleId}: assignment references unowned data`);
      }
    }
  }
  for (const slots of Object.values(record.additionalPositionSlots || {}) as any[]) {
    if (!Array.isArray(slots) || slots.some(slot => !String(slot).startsWith(`${scope.positionId}::`))) throw new Error(`Preserved ${scope.scheduleId}: extra positions reference unowned data`);
  }
  for (const field of ["microphoneAssignments", "iemAssignments", "responses"]) {
    if (Object.keys(record[field] || {}).length) throw new Error(`Preserved ${scope.scheduleId}: ${field} was adopted outside this test's allowed operations`);
  }
}
export function schedulingMutationAllowed(path: string, body: any, scope: SchedulingScope) {
  const root = `/api/churches/${encodeURIComponent(scope.churchId)}/team-schedules/`;
  if (!path.startsWith(root) || !body || typeof body !== "object") return false;
  if (path === root + "ensure") {
    return body.teamId === scope.teamId && body.startDate === scope.startDate && body.endDate === scope.endDate &&
      body.published !== true && (!body.publicationStatus || body.publicationStatus === "draft") && Array.isArray(body.serviceIds) && body.serviceIds.length > 0 &&
      body.serviceIds.every((id: string) => scope.serviceIds.includes(id)) &&
      Array.isArray(body.occurrences) && body.occurrences.length > 0 && body.occurrences.every((row: any) =>
        scope.serviceIds.includes(row.serviceId) && (!row.serviceIds || row.serviceIds.every((id: string) => scope.serviceIds.includes(id))) &&
        (!row.positionRequirements || row.positionRequirements.every((requirement: any) => requirement.positionId === scope.positionId)));
  }
  if (path === root + scope.scheduleId + "/delete") return true;
  if (path === root + scope.scheduleId + "/additional-position-slots") {
    return body.positionSlotKey === `${scope.positionId}::1` && typeof body.serviceId === "string" && scope.serviceIds.some(id => body.serviceId.startsWith(`${id}@`));
  }
  return path === root + scope.scheduleId + "/assignments" && body.memberId === scope.memberId &&
    body.positionSlotKey === `${scope.positionId}::0` && typeof body.serviceId === "string" &&
    scope.serviceIds.some(id => body.serviceId.startsWith(`${id}@`)) && !body.guest && !body.shadowAction;
}
