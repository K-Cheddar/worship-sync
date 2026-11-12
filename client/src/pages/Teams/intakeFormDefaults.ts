import type { IntakeFormDefaults } from "../../api/authTypes";
import { ALL_INTAKE_FORM_FIELDS } from "./intakeFormFields";

/** Copy reusable preferences; generated dates and Team/service scope stay with the caller. */
export const intakeCreationSettings = (
  defaults: IntakeFormDefaults,
  purpose: "general_intake" | "team_availability",
) => {
  const settings = defaults[purpose];
  return {
    enabledFields: purpose === "team_availability"
      ? ["availability" as const]
      : [...(defaults.general_intake?.enabledFields ?? ALL_INTAKE_FORM_FIELDS)],
    requireEmail: false,
    welcomeMessage: settings?.welcomeMessage || "",
    availabilityMessage: settings?.availabilityMessage || "",
    positionsMessage: purpose === "general_intake" ? defaults.general_intake?.positionsMessage || "" : "",
    notesMessage: purpose === "general_intake" ? defaults.general_intake?.notesMessage || "" : "",
  };
};
