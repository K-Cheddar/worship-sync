import type { TeamPosition, TeamSchedule, TeamScheduleOccurrence, TeamScheduleSummary, TeamService } from "../../../api/authTypes";
import { buildTeamSchedulePeriod } from "./teamSchedulePeriod";
import { resolveScheduleWorkspace } from "./scheduleWorkspaceModel";

const positions: TeamPosition[] = [{ positionId: "camera", churchId: "church", teamId: "media", name: "Camera" }];
const service = (serviceId: string, changes: Partial<TeamService> = {}): TeamService => ({
  id: serviceId, serviceId, churchId: "church", name: serviceId, timerType: "countdown",
  reccurence: "one_time", dateTimeISO: "2026-10-03T14:00:00.000Z",
  positionRequirements: [{ positionId: "camera", count: 1 }], ...changes,
});
const defaults = {
  churchId: "church", teamId: "media", timeZone: "America/New_York",
  range: { start: "2026-10-01", end: "2026-10-31" }, positions,
};
const occurrence = (item: TeamService) => buildTeamSchedulePeriod({
  services: [item], positions, teamId: "media", startDate: defaults.range.start,
  endDate: defaults.range.end, timeZone: defaults.timeZone,
}).occurrences[0];
const schedule = (scheduleId: string, occurrences: TeamScheduleOccurrence[], changes: Partial<TeamSchedule> = {}): TeamSchedule => ({
  scheduleId, churchId: "church", teamId: "media", name: scheduleId,
  startDate: defaults.range.start, endDate: defaults.range.end,
  serviceIds: occurrences.map((item) => item.serviceId), occurrences, assignments: {}, ...changes,
});
const resolve = (services: TeamService[], schedules: TeamScheduleSummary[] = []) =>
  resolveScheduleWorkspace({ ...defaults, services, schedules });

describe("resolveScheduleWorkspace", () => {
  it("keeps two different owners in the same month and unrelated services on the same date separate", () => {
    const services = [service("morning"), service("evening")];
    const schedules = services.map((item, index) => schedule(`owner-${index}`, [occurrence(item)]));
    const { rows } = resolve(services, schedules);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.owner?.scheduleId)).toEqual(["owner-1", "owner-0"]);
    expect(rows.every((row) => row.status === "saved" && row.owner?.hydrated)).toBe(true);
    expect(new Set(rows.map((row) => row.identity?.logicalOccurrenceId)).size).toBe(2);
  });

  it("preserves a saved monthly occurrence and an ad-hoc service absent from current definitions", () => {
    const regular = service("regular");
    const custom = occurrence(service("custom"));
    const { rows } = resolve([regular], [schedule("monthly", [occurrence(regular)]), schedule("one-time", [custom])]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.owner?.scheduleId === "one-time")?.occurrence).toBe(custom);
    expect(rows.every((row) => row.status === "saved")).toBe(true);
  });

  it("adds uncovered virtual occurrences without constructing a merged document or mutating input", () => {
    const services = [service("saved"), service("uncovered")];
    const saved = schedule("owner", [occurrence(services[0])], {
      assignments: { [occurrence(services[0]).occurrenceId]: { "camera::0": { primaryMemberId: "member" } } },
    });
    const before = JSON.stringify(saved);
    const { rows } = resolve(services, [saved]);
    expect(rows.find((row) => row.status === "saved")?.owner?.schedule).toBe(saved);
    expect(rows.find((row) => row.status === "virtual")).toMatchObject({ owner: null, reviewScheduleIds: [] });
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("preserves combined membership, legacy assignment keys and saved staffing overrides", () => {
    const services = [service("a", { serviceGroupId: "shared" }), service("b", { serviceGroupId: "shared" })];
    const combined = buildTeamSchedulePeriod({
      services, positions, teamId: "media", startDate: defaults.range.start,
      endDate: defaults.range.end, timeZone: defaults.timeZone,
    }).occurrences[0];
    const saved = { ...combined, occurrenceId: "legacy-group-key", positionRequirements: [{ positionId: "camera", count: 3 }] };
    const { rows } = resolve(services, [schedule("owner", [saved])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "saved", identity: { logicalOccurrenceId: "group:shared@2026-10-03", serviceIds: ["a", "b"] },
      owner: { savedOccurrenceId: "legacy-group-key" }, occurrence: { positionRequirements: saved.positionRequirements },
    });
    expect(rows[0].generatedOccurrence?.serviceIds).toEqual(["a", "b"]);
  });

  it("maps a legacy timestamp key through the shared identity utility", () => {
    const item = service("legacy");
    const saved = { ...occurrence(item), occurrenceId: "legacy@2026-10-03T14:00:00.000Z", logicalOccurrenceId: undefined };
    const { rows } = resolve([item], [schedule("owner", [saved])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner?.savedOccurrenceId).toBe(saved.occurrenceId);
    expect(rows[0].identity?.logicalOccurrenceId).toBe("legacy@2026-10-03");
  });

  it.each([false, true])("retains all conflicting rows for duplicate ownership (same document: %s)", (sameDocument) => {
    const item = service("duplicate");
    const saved = occurrence(item);
    const duplicate = { ...saved, occurrenceId: "old-key" };
    const schedules = sameDocument ? [schedule("one", [saved, duplicate])] :
      [schedule("one", [saved]), schedule("two", [duplicate])];
    const { rows } = resolve([item], schedules);
    expect(rows.filter((row) => row.owner)).toHaveLength(2);
    expect(rows.every((row) => row.status === "ambiguous")).toBe(true);
    expect(rows.every((row) => row.reviewScheduleIds.includes("one"))).toBe(true);
    expect(rows.find((row) => !row.owner)?.reviewScheduleIds).toEqual(schedules.map((owner) => owner.scheduleId));
  });

  it("retains incompatible grouped legacy rows and blocks their generated counterpart", () => {
    const a = service("a", { serviceGroupId: "shared" });
    const b = service("b", { serviceGroupId: "shared" });
    const legacy = occurrence({ ...a, serviceGroupId: undefined });
    const { rows } = resolve([a, b], [schedule("review", [legacy])]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "ambiguous" && row.reviewScheduleIds.includes("review"))).toBe(true);
    expect(rows.find((row) => row.owner)?.occurrence).toBe(legacy);
  });

  it("retains an unidentifiable persisted row for review", () => {
    const legacy = { ...occurrence(service("old")), serviceId: "", occurrenceId: "unknown", logicalOccurrenceId: undefined };
    const { rows } = resolve([], [schedule("review", [legacy])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ identity: null, status: "ambiguous", reviewScheduleIds: ["review"] });
  });

  it("never exposes summary-only schedules as empty staffing and returns distinct hydration IDs", () => {
    const items = [service("a"), service("b")];
    const full = schedule("full", [occurrence(items[0])]);
    const summaryFields: TeamScheduleSummary = {
      scheduleId: "summary", churchId: "church", teamId: "media", name: "Summary",
      serviceIds: ["b"], occurrences: [occurrence(items[1])],
    };
    const summary: TeamScheduleSummary = { ...summaryFields, assignmentsOmitted: true };
    const result = resolve(items, [full, summary]);
    expect(result.requiredHydrationScheduleIds).toEqual(["summary"]);
    expect(result.rows.find((row) => row.owner?.scheduleId === "summary")?.owner).toEqual({
      scheduleId: "summary", savedOccurrenceId: occurrence(items[1]).occurrenceId, hydrated: false, schedule: null,
    });
    expect(resolve(items, [full, schedule("summary", [occurrence(items[1])])]).requiredHydrationScheduleIds).toEqual([]);
  });

  it("uses saved occurrence dates rather than trusting stale schedule bounds", () => {
    const item = service("saved");
    const owner = schedule("owner", [occurrence(item)], { startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(resolve([item], [owner]).rows).toMatchObject([{ status: "saved", owner: { scheduleId: "owner" } }]);
  });

  it("keeps explicit saved slots and saved rows when current services have no Team requirements", () => {
    const item = service("slot-only", { positionRequirements: [] });
    const saved = { ...occurrence(service("slot-only")), positionRequirements: [] };
    const owner = schedule("owner", [saved], { additionalPositionSlots: { [saved.occurrenceId]: ["camera::0"] } });
    const result = resolve([item], [owner]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].owner?.schedule).toBe(owner);
    expect(result.rows[0].occurrence.positionRequirements).toEqual([]);
    expect(resolve([service("other-team", { positionRequirements: [{ positionId: "vocal", count: 1 }] })]).rows).toEqual([]);
  });

  it("scopes church, Team, archived records and inclusive church-local date boundaries", () => {
    const first = service("first", { dateTimeISO: "2026-10-01T04:00:00.000Z" });
    const last = service("last", { dateTimeISO: "2026-11-01T03:59:00.000Z" });
    const outside = service("outside", { dateTimeISO: "2026-11-01T04:00:00.000Z" });
    const otherChurch = service("other-church", { churchId: "other" });
    const item = occurrence(first);
    const result = resolve([first, last, outside, otherChurch], [
      schedule("other-team", [item], { teamId: "other" }),
      schedule("other-church", [item], { churchId: "other" }),
      schedule("archived", [item], { archivedAt: "2026-10-01" }),
    ]);
    expect(result.rows.map((row) => row.occurrence.serviceId).sort()).toEqual(["first", "last"]);
    expect(result.rows.every((row) => row.status === "virtual")).toBe(true);
    expect(resolveScheduleWorkspace({ ...defaults, range: { start: "2026-10-02", end: "2026-10-02" }, services: [first, last], schedules: [] }).rows).toEqual([]);
  });
});
