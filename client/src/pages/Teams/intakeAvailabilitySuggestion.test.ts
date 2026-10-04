import type { TeamIntakeForm, TeamService } from "../../api/authTypes";
import { generateScheduleOccurrences } from "../../utils/teamScheduleOccurrences";
import { getUpcomingAvailabilitySuggestion } from "./intakeAvailabilitySuggestion";

const service: TeamService = {
  id: "sunday",
  serviceId: "sunday",
  churchId: "church-1",
  name: "Sunday service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
};

const makeForm = (overrides: Partial<TeamIntakeForm> = {}): TeamIntakeForm => ({
  formId: "form-1",
  churchId: "church-1",
  name: "September availability",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  availabilityServices: [{ serviceId: "sunday", name: "Sunday service" }],
  availabilityOccurrences: [],
  teamIds: [],
  active: true,
  enabledFields: ["availability"],
  ...overrides,
});

describe("getUpcomingAvailabilitySuggestion", () => {
  it("suggests the full current month when today is mid-month", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [service],
      forms: [],
      now: new Date(2026, 9, 4, 12),
    });

    expect(result).toMatchObject({
      name: "October Availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(result?.draft.availabilityOccurrences).toHaveLength(3);
  });

  it("advances a fully covered current month to the next complete month", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [service],
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        responseDeadline: "2026-10-31",
      })],
      now: new Date(2026, 9, 4, 12),
    });

    expect(result).toMatchObject({
      name: "November Availability",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      occurrenceCount: 5,
    });
  });

  it("lists only uncovered services while preserving the existing form occurrence", () => {
    const octoberOccurrences = generateScheduleOccurrences({
      services: [service],
      serviceIds: [service.serviceId],
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    const coveredOccurrence = octoberOccurrences[0];
    const result = getUpcomingAvailabilitySuggestion({
      services: [service],
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        responseDeadline: "2026-10-31",
        availabilityOccurrences: [{
          occurrenceId: coveredOccurrence.occurrenceId,
          serviceId: coveredOccurrence.serviceId,
          name: coveredOccurrence.name,
          startsAt: coveredOccurrence.startsAt,
        }],
      })],
      now: new Date(2026, 9, 4, 12),
    });

    expect(result).toMatchObject({
      kind: "update",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      occurrenceCount: 3,
    });
    expect(result?.missingOccurrences.map(({ occurrenceId }) => occurrenceId))
      .not.toContain(coveredOccurrence.occurrenceId);
    expect(result?.draft.availabilityOccurrences?.map(({ occurrenceId }) => occurrenceId))
      .toContain(coveredOccurrence.occurrenceId);
  });

  it("ignores an existing form's missing occurrence when it is already in the past", () => {
    const octFirstService: TeamService = {
      ...service,
      reccurence: "one_time",
      dateTimeISO: "2026-10-01T14:00:00.000Z",
    };
    const result = getUpcomingAvailabilitySuggestion({
      services: [octFirstService],
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        availabilityServices: [],
        availabilityOccurrences: [],
      })],
      now: new Date("2026-10-04T16:00:00.000Z"),
    });

    expect(result).toBeNull();
  });

  it("ignores a service earlier today but keeps a later service actionable", () => {
    const earlierService: TeamService = {
      ...service,
      serviceId: "earlier",
      reccurence: "one_time",
      dateTimeISO: "2026-10-04T14:00:00.000Z",
    };
    const laterService: TeamService = {
      ...service,
      serviceId: "later",
      name: "Evening service",
      reccurence: "one_time",
      dateTimeISO: "2026-10-04T18:00:00.000Z",
    };
    const now = new Date("2026-10-04T16:00:00.000Z");
    const earlierResult = getUpcomingAvailabilitySuggestion({
      services: [earlierService],
      forms: [],
      now,
    });
    const laterResult = getUpcomingAvailabilitySuggestion({
      services: [laterService],
      forms: [],
      now,
    });

    expect(earlierResult).toBeNull();
    expect(laterResult?.kind).toBe("create");
    expect(laterResult?.missingOccurrences.map(({ serviceId }) => serviceId)).toEqual(["later"]);
  });

  it("keeps the full month range but excludes an earlier one-time service from a new form", () => {
    const pastService: TeamService = {
      ...service,
      serviceId: "october-first",
      name: "October first service",
      reccurence: "one_time",
      dateTimeISO: "2026-10-01T14:00:00.000Z",
    };
    const futureService: TeamService = {
      ...service,
      serviceId: "october-fourteenth",
      name: "October fourteenth service",
      reccurence: "one_time",
      dateTimeISO: "2026-10-14T14:00:00.000Z",
    };
    const result = getUpcomingAvailabilitySuggestion({
      services: [pastService, futureService],
      forms: [],
      now: new Date("2026-10-04T16:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "create",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(result?.draft.availabilityOccurrences.map(({ serviceId }) => serviceId)).toEqual(["october-fourteenth"]);
  });

  it("returns an update suggestion with the missing future occurrence", () => {
    const futureService: TeamService = {
      ...service,
      serviceId: "power-up",
      name: "Power Up",
      reccurence: "one_time",
      dateTimeISO: "2026-10-14T14:00:00.000Z",
    };
    const result = getUpcomingAvailabilitySuggestion({
      services: [futureService],
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        availabilityServices: [],
        availabilityOccurrences: [],
      })],
      now: new Date("2026-10-04T16:00:00.000Z"),
    });

    expect(result?.kind).toBe("update");
    expect(result).toMatchObject({ formId: "form-1", occurrenceCount: 1 });
    expect(result?.missingOccurrences).toMatchObject([
      { name: "Power Up", startsAt: "2026-10-14T14:00:00.000Z" },
    ]);
  });

  it("recognizes combined-service coverage when stored occurrence IDs predate grouping", () => {
    const groupServices: TeamService[] = ["sunday-a", "sunday-b"].map((serviceId) => ({
      ...service,
      serviceId,
      name: `${serviceId} service`,
      reccurence: "one_time",
      dateTimeISO: "2026-10-11T14:00:00.000Z",
      serviceGroupId: "combined-sunday",
    }));
    const result = getUpcomingAvailabilitySuggestion({
      services: groupServices,
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        availabilityServices: groupServices.map(({ serviceId, name }) => ({ serviceId, name })),
        availabilityOccurrences: groupServices.map(({ serviceId, name }) => ({
          occurrenceId: `${serviceId}@2026-10-11T14:00:00.000Z`,
          serviceId,
          name,
          startsAt: "2026-10-11T14:00:00.000Z",
        })),
      })],
      now: new Date("2026-10-04T16:00:00.000Z"),
    });

    expect(result).toBeNull();
  });

  it("does not let a saved combined occurrence cover a service added to its group later", () => {
    const groupServices: TeamService[] = ["sunday-a", "sunday-b", "sunday-c"].map((serviceId) => ({
      ...service,
      serviceId,
      name: `${serviceId} service`,
      reccurence: "one_time",
      dateTimeISO: "2026-10-11T14:00:00.000Z",
      serviceGroupId: "combined-sunday",
    }));
    const result = getUpcomingAvailabilitySuggestion({
      services: groupServices,
      forms: [makeForm({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        availabilityServices: groupServices.slice(0, 2).map(({ serviceId, name }) => ({ serviceId, name })),
        availabilityOccurrences: [{
          occurrenceId: "group:combined-sunday@2026-10-11",
          serviceId: "sunday-a",
          name: "sunday-a service & sunday-b service",
          startsAt: "2026-10-11T14:00:00.000Z",
        }],
      })],
      now: new Date("2026-10-04T16:00:00.000Z"),
    });

    expect(result?.kind).toBe("update");
    expect(result?.missingOccurrences.map(({ serviceIds }) => serviceIds)).toEqual([
      ["sunday-a", "sunday-b", "sunday-c"],
    ]);
  });

  it("advances past a candidate month with no occurrences to the next useful month", () => {
    const serviceStartingNextMonth: TeamService = {
      ...service,
      startDateISO: "2026-11-01",
      overrideDateTimeISO: "2026-10-15T10:00:00.000Z",
    };
    const result = getUpcomingAvailabilitySuggestion({
      services: [serviceStartingNextMonth],
      forms: [],
      now: new Date("2026-10-04T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      name: "November Availability",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      occurrenceCount: 5,
    });
  });

  it("starts with the month of the next service across a month boundary", () => {
    const novemberService: TeamService = {
      ...service,
      startDateISO: "2026-11-01",
    };
    const result = getUpcomingAvailabilitySuggestion({
      services: [novemberService],
      forms: [],
      now: new Date("2026-10-04T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      name: "November Availability",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
  });

  it("suggests the next month with uncovered occurrences and creates only an editable draft", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [service],
      forms: [],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result).toMatchObject({
      name: "October Availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      occurrenceCount: 4,
      serviceCount: 1,
    });
    expect(result?.draft.availabilityOccurrences).toHaveLength(4);
  });

  it("does not suggest a month when an active form already covers its upcoming services", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [{ ...service, endDateISO: "2026-10-31" }],
      forms: [makeForm({ startDate: "2026-09-29", endDate: "2026-10-31" })],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result).toBeNull();
  });

  it("does not let a scoped form suppress an all-teams suggestion", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [{ ...service, endDateISO: "2026-10-31" }],
      forms: [
        makeForm({ formId: "future-template", startDate: "2026-11-01", endDate: "2026-11-30", teamIds: [] }),
        makeForm({ formId: "worship-only", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: ["worship"] }),
      ],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result?.draft.teamIds).toEqual([]);
    expect(result?.occurrenceCount).toBeGreaterThan(0);
  });

  it("allows an all-teams form to cover a scoped suggestion", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [{ ...service, endDateISO: "2026-10-31" }],
      forms: [
        makeForm({ formId: "template", startDate: "2026-11-01", endDate: "2026-11-30", teamIds: ["worship"] }),
        makeForm({ formId: "covering", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: [] }),
      ],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result).toBeNull();
  });

  it("does not treat partial scoped coverage as full coverage", () => {
    const result = getUpcomingAvailabilitySuggestion({
      services: [{ ...service, endDateISO: "2026-10-31" }],
      forms: [
        makeForm({ formId: "template", startDate: "2026-11-01", endDate: "2026-11-30", teamIds: ["worship", "media"] }),
        makeForm({ formId: "covering", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: ["worship"] }),
      ],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result?.draft.teamIds).toEqual(["worship", "media"]);
    expect(result?.occurrenceCount).toBeGreaterThan(0);
  });

  it("suppresses suggestions only for open covering forms, using endDate when no deadline is stored", () => {
    const services = [{ ...service, endDateISO: "2026-10-31" }];
    const now = new Date("2026-09-29T12:00:00.000Z");
    const futureDeadline = getUpcomingAvailabilitySuggestion({
      services,
      forms: [makeForm({ startDate: "2026-09-29", endDate: "2026-10-31", responseDeadline: "2026-10-01" })],
      now,
    });
    const expiredDeadline = getUpcomingAvailabilitySuggestion({
      services,
      forms: [makeForm({ startDate: "2026-09-29", endDate: "2026-10-31", responseDeadline: "2026-09-28" })],
      now,
    });
    const fallbackFuture = getUpcomingAvailabilitySuggestion({
      services,
      forms: [makeForm({ startDate: "2026-09-29", endDate: "2026-10-31", responseDeadline: undefined })],
      now,
    });
    const fallbackExpired = getUpcomingAvailabilitySuggestion({
      services,
      forms: [makeForm({ startDate: "2026-09-01", endDate: "2026-09-28", responseDeadline: undefined })],
      now,
    });

    expect(futureDeadline).toBeNull();
    expect(fallbackFuture).toBeNull();
    expect(expiredDeadline?.occurrenceCount).toBeGreaterThan(0);
    expect(fallbackExpired?.occurrenceCount).toBeGreaterThan(0);
  });

  it("suppresses duplicates only for active equivalent-scope forms", () => {
    const services = [{ ...service, endDateISO: "2026-10-31" }];
    const template = makeForm({ formId: "template", startDate: "2026-08-01", endDate: "2026-08-31", teamIds: ["worship"] });
    const result = getUpcomingAvailabilitySuggestion({
      services,
      forms: [template, makeForm({ formId: "covering", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: ["worship"] })],
      now: new Date(2026, 8, 29, 12),
    });
    const inactiveResult = getUpcomingAvailabilitySuggestion({
      services,
      forms: [template, makeForm({ formId: "inactive", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: ["worship"], active: false })],
      now: new Date(2026, 8, 29, 12),
    });
    const archivedResult = getUpcomingAvailabilitySuggestion({
      services,
      forms: [template, makeForm({ formId: "archived", startDate: "2026-09-29", endDate: "2026-10-31", teamIds: ["worship"], archivedAt: "2026-09-01" })],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result).toBeNull();
    expect(inactiveResult?.occurrenceCount).toBeGreaterThan(0);
    expect(archivedResult?.occurrenceCount).toBeGreaterThan(0);
  });

  it("reuses safe prior wording and field settings without copying form state", () => {
    const prior = makeForm({
      name: "Old form",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      teamIds: ["worship"],
      enabledFields: ["firstName", "availability"],
      requireEmail: true,
      welcomeMessage: "Welcome back",
      positionsMessage: "Choose positions",
      availabilityMessage: "Mark dates",
      notesMessage: "Add a note",
      formId: "old-form",
      publicUrl: "https://example.test/old",
      submissionCount: 8,
    });
    const result = getUpcomingAvailabilitySuggestion({
      services: [service],
      forms: [prior],
      now: new Date(2026, 8, 29, 12),
    });

    expect(result?.draft).toMatchObject({
      enabledFields: ["firstName", "availability"],
      teamIds: ["worship"],
      requireEmail: true,
      welcomeMessage: "Welcome back",
      positionsMessage: "Choose positions",
      availabilityMessage: "Mark dates",
      notesMessage: "Add a note",
    });
    expect(result?.draft).not.toHaveProperty("formId");
    expect(result?.draft).not.toHaveProperty("publicUrl");
    expect(result?.draft).not.toHaveProperty("submissionCount");
  });
});
