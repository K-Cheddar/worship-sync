import type { TeamIntakeForm, TeamService } from "../../api/authTypes";
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
