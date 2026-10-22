import {
  INTAKE_FORM_FIELD_OPTIONS,
  resolveIntakeFormFields,
  isAvailabilityFocusedForm,
} from "./intakeFormFields";
import type { TeamIntakeForm } from "../../api/authTypes";

const legacyForm: TeamIntakeForm = {
  formId: "october",
  churchId: "church",
  name: "October Availability",
  purpose: "general_intake",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  active: true,
  teamIds: [],
  availabilityServices: [{ serviceId: "sunday", name: "Sunday" }],
  availabilityOccurrences: [],
};

test.each([
  [
    "explicit availability",
    { purpose: "team_availability", availabilityServices: [] },
    true,
  ],
  [
    "general-intake service dates",
    { enabledFields: ["firstName", "email", "availability", "notes"] },
    true,
  ],
  [
    "omitted purpose and fields",
    { purpose: undefined, enabledFields: undefined },
    true,
  ],
  [
    "saved snapshot without services",
    {
      availabilityServices: [],
      availabilityOccurrences: [
        {
          occurrenceId: "sunday@2026-10-04",
          serviceId: "sunday",
          name: "Sunday",
          startsAt: "2026-10-04T10:00:00Z",
        },
      ],
    },
    true,
  ],
  ["availability field without dates", { availabilityServices: [] }, false],
  [
    "availability disabled with historical dates",
    { enabledFields: ["firstName", "email"] },
    false,
  ],
  [
    "name alone",
    {
      name: "October Availability",
      availabilityServices: [],
      enabledFields: ["notes"],
    },
    false,
  ],
  [
    "unrelated name with service availability",
    { name: "Volunteer information" },
    true,
  ],
] satisfies Array<[string, Partial<TeamIntakeForm>, boolean]>)(
  "classifies %s for presentation without mutating metadata",
  (_name, overrides, expected) => {
    const record = { ...legacyForm, ...overrides };
    const before = JSON.stringify(record);
    expect(isAvailabilityFocusedForm(record)).toBe(expected);
    expect(JSON.stringify(record)).toBe(before);
  },
);

describe("intake form fields", () => {
  it("keeps legacy scheduling fields together", () => {
    expect(
      resolveIntakeFormFields({ enabledFields: ["schedulingPreferences"] }),
    ).toEqual(["recurringAvailability", "schedulingFrequency"]);
  });

  it("offers independent scheduling controls", () => {
    expect(INTAKE_FORM_FIELD_OPTIONS).toEqual(
      expect.arrayContaining([
        { id: "recurringAvailability", label: "Scheduling preferences" },
        { id: "schedulingFrequency", label: "Scheduling frequency" },
      ]),
    );
  });
});
