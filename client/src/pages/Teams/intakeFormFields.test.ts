import {
  INTAKE_FORM_FIELD_OPTIONS,
  resolveIntakeFormFields,
} from "./intakeFormFields";

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
