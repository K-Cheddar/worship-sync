import type { TeamIntakeForm, TeamService } from "../../api/authTypes";
import type { TeamIntakeFormPayload } from "../../api/auth";
import { generateScheduleOccurrences } from "../../utils/teamScheduleOccurrences";
import { ALL_INTAKE_FORM_FIELDS, resolveIntakeFormFields } from "./intakeFormFields";

export type UpcomingAvailabilitySuggestion = {
  name: string;
  startDate: string;
  endDate: string;
  serviceCount: number;
  occurrenceCount: number;
  draft: TeamIntakeFormPayload;
};

const toPlainDate = (date: Date) => {
  // Match the server's plain-date deadline comparison, which uses the UTC
  // calendar date rather than interpreting these date-only values in local time.
  return date.toISOString().slice(0, 10);
};

const isEffectivelyOpen = (form: TeamIntakeForm, today: string) => {
  const deadline = form.responseDeadline || form.endDate;
  return Boolean(form.active && !form.archivedAt && deadline && deadline >= today);
};

const monthLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });

const safeTemplate = (forms: TeamIntakeForm[]) =>
  forms
    .filter((form) => !form.archivedAt && resolveIntakeFormFields(form).includes("availability"))
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];

const getFormOccurrenceIds = (form: TeamIntakeForm, services: TeamService[]) => {
  const occurrences = form.availabilityOccurrences?.length
    ? form.availabilityOccurrences
    : generateScheduleOccurrences({
        services,
        serviceIds: (form.availabilityServices || []).map(({ serviceId }) => serviceId),
        startDate: form.startDate,
        endDate: form.endDate,
      });
  return new Set(occurrences.map(({ occurrenceId }) => occurrenceId));
};

const scopeCovers = (existingTeamIds: string[], proposedTeamIds: string[]) => {
  // Empty means all teams. An all-teams form only fully covers another all-teams suggestion;
  // a scoped suggestion is covered by either all teams or an existing superset scope.
  if (proposedTeamIds.length === 0) return existingTeamIds.length === 0;
  if (existingTeamIds.length === 0) return true;
  const existingScope = new Set(existingTeamIds);
  return proposedTeamIds.every((teamId) => existingScope.has(teamId));
};

export const getUpcomingAvailabilitySuggestion = ({
  services,
  forms,
  now = new Date(),
}: {
  services: TeamService[];
  forms: TeamIntakeForm[];
  now?: Date;
}): UpcomingAvailabilitySuggestion | null => {
  const today = toPlainDate(now);
  const activeServices = services.filter((service) => !service.archivedAt);
  if (!activeServices.length) return null;

  const template = safeTemplate(forms);
  const proposedTeamIds = template?.teamIds || [];
  const coveringForms = forms.filter((form) =>
    isEffectivelyOpen(form, today) && scopeCovers(form.teamIds || [], proposedTeamIds),
  );
  const coveredOccurrenceIds = new Set<string>();
  coveringForms.forEach((form) => {
    getFormOccurrenceIds(form, services).forEach((id) => coveredOccurrenceIds.add(id));
  });

  // Look ahead only far enough to find the next useful month; no records are created.
  for (let offset = 0; offset < 12; offset += 1) {
    const month = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + offset,
      1,
      12,
    ));
    const startDate = offset === 0 ? today : toPlainDate(month);
    const endDate = toPlainDate(new Date(Date.UTC(
      month.getUTCFullYear(),
      month.getUTCMonth() + 1,
      0,
      12,
    )));
    const occurrences = generateScheduleOccurrences({
      services: activeServices,
      serviceIds: activeServices.map(({ serviceId }) => serviceId),
      startDate,
      endDate,
    });
    const uncovered = occurrences.filter(({ occurrenceId }) => !coveredOccurrenceIds.has(occurrenceId));
    if (!uncovered.length) continue;

    const serviceIds = [...new Set(uncovered.flatMap((occurrence) => occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId]))];
    const serviceById = new Map(activeServices.map((service) => [service.serviceId, service]));
    const label = monthLabel(month);
    const draft: TeamIntakeFormPayload = {
      name: `${label} Availability`,
      startDate,
      endDate,
      responseDeadline: endDate,
      availabilityServices: serviceIds.map((serviceId) => ({
        serviceId,
        name: serviceById.get(serviceId)?.name || serviceId,
      })),
      availabilityOccurrences: uncovered.map(({ occurrenceId, serviceId, name, startsAt }) => ({ occurrenceId, serviceId, name, startsAt })),
      teamIds: template?.teamIds ? [...template.teamIds] : [],
      active: true,
      enabledFields: template ? resolveIntakeFormFields(template) : [...ALL_INTAKE_FORM_FIELDS],
      requireEmail: Boolean(template?.requireEmail),
      welcomeMessage: template?.welcomeMessage || "",
      positionsMessage: template?.positionsMessage || "",
      availabilityMessage: template?.availabilityMessage || "",
      notesMessage: template?.notesMessage || "",
    };
    return {
      name: draft.name,
      startDate,
      endDate,
      serviceCount: serviceIds.length,
      occurrenceCount: uncovered.length,
      draft,
    };
  }
  return null;
};
