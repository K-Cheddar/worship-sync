import type { TeamIntakeFieldId, TeamIntakeForm } from "../../api/authTypes";

export const LEGACY_INTAKE_FORM_FIELDS: TeamIntakeFieldId[] = [
  "firstName",
  "lastName",
  "email",
  "positions",
  "availability",
  "blockoutDates",
  "notes",
];

export const ALL_INTAKE_FORM_FIELDS: TeamIntakeFieldId[] = [
  "firstName",
  "lastName",
  "email",
  "title",
  "birthDate",
  "positions",
  "availability",
  "schedulingPreferences",
  "blockoutDates",
  "notes",
];

export const INTAKE_FORM_FIELD_OPTIONS: Array<{
  id: TeamIntakeFieldId;
  label: string;
}> = [
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "email", label: "Email" },
  { id: "title", label: "Title" },
  { id: "birthDate", label: "Birthday (year optional)" },
  { id: "positions", label: "Positions" },
  { id: "availability", label: "Service date availability" },
  { id: "schedulingPreferences", label: "Scheduling preferences" },
  { id: "blockoutDates", label: "Blockout dates" },
  { id: "notes", label: "Notes" },
];

export const resolveIntakeFormFields = (
  form: Pick<TeamIntakeForm, "enabledFields">,
): TeamIntakeFieldId[] =>
  Array.isArray(form.enabledFields)
    ? form.enabledFields
    : LEGACY_INTAKE_FORM_FIELDS;
