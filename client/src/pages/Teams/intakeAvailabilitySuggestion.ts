import type { TeamIntakeForm, TeamService } from "../../api/authTypes";
import type { TeamIntakeFormPayload } from "../../api/auth";
import { serverDate } from "../../utils/serverTime";
import { generateScheduleOccurrences } from "../../utils/teamScheduleOccurrences";
import { parsePlainDate } from "../../utils/plainDate";
import { ALL_INTAKE_FORM_FIELDS, resolveIntakeFormFields } from "./intakeFormFields";
import { getUpcomingServiceRange } from "./servicePeriodRange";
import { shiftRange } from "./rangeSelection";

export type UpcomingAvailabilitySuggestion = {
  name: string;
  startDate: string;
  endDate: string;
  serviceCount: number;
  occurrenceCount: number;
  draft: TeamIntakeFormPayload;
};

const isEffectivelyOpen = (form: TeamIntakeForm, today: string) => {
  const deadline = form.responseDeadline || form.endDate;
  return Boolean(form.active && !form.archivedAt && deadline && deadline >= today);
};

const monthLabel = (startDate: string) =>
  parsePlainDate(startDate)?.toLocaleDateString(undefined, { month: "long" }) || "";

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
  now = serverDate(),
}: {
  services: TeamService[];
  forms: TeamIntakeForm[];
  now?: Date;
}): UpcomingAvailabilitySuggestion | null => {
  // Match the server's response-deadline comparison, which treats date-only
  // deadlines as UTC calendar dates. Period ranges below retain local calendar semantics.
  const today = now.toISOString().slice(0, 10);
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

  // Upcoming starts with the same full period used by the Teams range selector.
  // Look ahead only far enough to find the next useful month; no records are created.
  let range = getUpcomingServiceRange(activeServices, now);
  for (let offset = 0; offset < 12; offset += 1) {
    const occurrences = generateScheduleOccurrences({
      services: activeServices,
      serviceIds: activeServices.map(({ serviceId }) => serviceId),
      startDate: range.start,
      endDate: range.end,
    });
    const uncovered = occurrences.filter(({ occurrenceId }) => !coveredOccurrenceIds.has(occurrenceId));
    if (!uncovered.length) {
      range = shiftRange("upcoming", range, 1);
      continue;
    }

    const serviceIds = [...new Set(uncovered.flatMap((occurrence) => occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId]))];
    const serviceById = new Map(activeServices.map((service) => [service.serviceId, service]));
    const label = monthLabel(range.start);
    const draft: TeamIntakeFormPayload = {
      name: `${label} Availability`,
      startDate: range.start,
      endDate: range.end,
      responseDeadline: range.end,
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
      startDate: range.start,
      endDate: range.end,
      serviceCount: serviceIds.length,
      occurrenceCount: uncovered.length,
      draft,
    };
  }
  return null;
};
