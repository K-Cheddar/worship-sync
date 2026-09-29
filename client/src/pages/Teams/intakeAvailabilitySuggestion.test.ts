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
