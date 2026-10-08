import type { TeamIntakeForm, TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import type { TeamIntakeFormPayload } from "../../api/auth";
import { serverDate } from "../../utils/serverTime";
import { calendarDateInTimeZone, generateScheduleOccurrences, getOccurrenceDate } from "../../utils/teamScheduleOccurrences";
import { parsePlainDate } from "../../utils/plainDate";
import { ALL_INTAKE_FORM_FIELDS, resolveIntakeFormFields } from "./intakeFormFields";
import { getUpcomingServiceRange } from "./servicePeriodRange";
import { shiftRange } from "./rangeSelection";

type SuggestedAvailabilityOccurrence = Pick<TeamScheduleOccurrence, "occurrenceId" | "serviceId" | "name" | "startsAt" | "serviceDate">;

type SuggestionBase = {
  name: string;
  startDate: string;
  endDate: string;
  serviceCount: number;
  occurrenceCount: number;
  missingOccurrences: TeamScheduleOccurrence[];
  draft: TeamIntakeFormPayload;
};

export type UpcomingAvailabilitySuggestion =
  | (SuggestionBase & { kind: "create" })
  | (SuggestionBase & { kind: "update"; formId: string });

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

const getFormOccurrences = (form: TeamIntakeForm, services: TeamService[], timeZone?: string) =>
  form.availabilityOccurrences?.length
    ? form.availabilityOccurrences
    : generateScheduleOccurrences({
        services,
        serviceIds: (form.availabilityServices || []).map(({ serviceId }) => serviceId),
        startDate: form.startDate,
        endDate: form.endDate,
        timeZone,
      });

const scopeCovers = (existingTeamIds: string[], proposedTeamIds: string[]) => {
  // Empty means all teams. An all-teams form only fully covers another all-teams suggestion;
  // a scoped suggestion is covered by either all teams or an existing superset scope.
  if (proposedTeamIds.length === 0) return existingTeamIds.length === 0;
  if (existingTeamIds.length === 0) return true;
  const existingScope = new Set(existingTeamIds);
  return proposedTeamIds.every((teamId) => existingScope.has(teamId));
};

const getOccurrenceCoverageKeys = (
  occurrence: Pick<TeamScheduleOccurrence, "occurrenceId" | "serviceId" | "serviceIds" | "startsAt" | "serviceDate">,
  servicesByGroupId: Map<string, string[]>,
  allowedServiceIds?: Set<string>,
  timeZone?: string,
) => {
  const groupId = occurrence.occurrenceId.startsWith("group:")
    ? occurrence.occurrenceId.slice("group:".length).split("@")[0]
    : "";
  const groupedServiceIds = groupId ? servicesByGroupId.get(groupId) : undefined;
  let serviceIds: string[];
  if (occurrence.serviceIds?.length) {
    serviceIds = occurrence.serviceIds;
  } else if (groupedServiceIds && allowedServiceIds) {
    serviceIds = groupedServiceIds.filter((serviceId) => allowedServiceIds.has(serviceId));
  } else {
    serviceIds = groupedServiceIds || [occurrence.serviceId];
  }
  const date = getOccurrenceDate(occurrence, timeZone || "UTC");
  const coveredServiceIds = serviceIds.length ? serviceIds : [occurrence.serviceId];
  return coveredServiceIds.map((serviceId) => `${serviceId}@${date}`);
};

const getCoverageKeys = (forms: TeamIntakeForm[], services: TeamService[], timeZone?: string) => {
  const servicesByGroupId = new Map<string, string[]>();
  services.forEach((service) => {
    if (!service.serviceGroupId) return;
    const groupServices = servicesByGroupId.get(service.serviceGroupId) || [];
    groupServices.push(service.serviceId);
    servicesByGroupId.set(service.serviceGroupId, groupServices);
  });

  const keys = new Set<string>();
  forms.forEach((form) => {
    const allowedServiceIds = new Set((form.availabilityServices || []).map(({ serviceId }) => serviceId));
    getFormOccurrences(form, services, timeZone).forEach((occurrence) => {
      getOccurrenceCoverageKeys(occurrence, servicesByGroupId, allowedServiceIds, timeZone).forEach((key) => keys.add(key));
    });
  });
  return { keys, servicesByGroupId };
};

const getServiceIds = (occurrences: TeamScheduleOccurrence[]) =>
  [...new Set(occurrences.flatMap((occurrence) =>
    occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId],
  ))];

const getDraftForForm = (
  form: TeamIntakeForm,
  missingOccurrences: TeamScheduleOccurrence[],
  servicesById: Map<string, TeamService>,
): TeamIntakeFormPayload => {
  const existingOccurrences: SuggestedAvailabilityOccurrence[] = form.availabilityOccurrences || [];
  const knownOccurrenceIds = new Set(existingOccurrences.map(({ occurrenceId }) => occurrenceId));
  const appendedOccurrences = missingOccurrences
    .filter(({ occurrenceId }) => !knownOccurrenceIds.has(occurrenceId))
    .map(({ occurrenceId, serviceId, name, startsAt, serviceDate }) => ({ occurrenceId, serviceId, name, startsAt, serviceDate }));
  const availabilityServices = [...(form.availabilityServices || [])];
  const knownServiceIds = new Set(availabilityServices.map(({ serviceId }) => serviceId));
  getServiceIds(missingOccurrences).forEach((serviceId) => {
    if (knownServiceIds.has(serviceId)) return;
    availabilityServices.push({
      serviceId,
      name: servicesById.get(serviceId)?.name || serviceId,
    });
  });

  return {
    name: form.name,
    startDate: form.startDate,
    endDate: form.endDate,
    responseDeadline: form.responseDeadline || form.endDate,
    availabilityServices,
    availabilityOccurrences: [...existingOccurrences, ...appendedOccurrences],
    teamIds: [...(form.teamIds || [])],
    active: form.active,
    enabledFields: resolveIntakeFormFields(form),
    requireEmail: Boolean(form.requireEmail),
    welcomeMessage: form.welcomeMessage || "",
    positionsMessage: form.positionsMessage || "",
    availabilityMessage: form.availabilityMessage || "",
    notesMessage: form.notesMessage || "",
  };
};

export const getUpcomingAvailabilitySuggestion = ({
  services,
  forms,
  now = serverDate(),
  timeZone,
}: {
  services: TeamService[];
  forms: TeamIntakeForm[];
  now?: Date;
  timeZone?: string;
}): UpcomingAvailabilitySuggestion | null => {
  const today = calendarDateInTimeZone(now, timeZone || "UTC");
  const activeServices = services.filter((service) => !service.archivedAt);
  if (!activeServices.length) return null;

  const template = safeTemplate(forms);
  const proposedTeamIds = template?.teamIds || [];
  const coveringForms = forms.filter((form) =>
    isEffectivelyOpen(form, today) &&
    resolveIntakeFormFields(form).includes("availability") &&
    scopeCovers(form.teamIds || [], proposedTeamIds),
  );
  const { keys: coveredOccurrenceKeys, servicesByGroupId } = getCoverageKeys(coveringForms, services, timeZone);
  const servicesById = new Map(activeServices.map((service) => [service.serviceId, service]));
  // Upcoming starts with the same full period used by the Teams range selector.
  // Look ahead only far enough to find the next useful month; no records are created.
  let range = getUpcomingServiceRange(activeServices, now, timeZone);
  for (let offset = 0; offset < 12; offset += 1) {
    const periodOccurrences = generateScheduleOccurrences({
      services: activeServices,
      serviceIds: activeServices.map(({ serviceId }) => serviceId),
      startDate: range.start,
      endDate: range.end,
      timeZone,
    });
    const actionableOccurrences = periodOccurrences.filter(
      (occurrence) => Date.parse(occurrence.startsAt) > now.getTime(),
    );
    const candidateRange = range;
    const uncovered = actionableOccurrences.filter((occurrence) =>
      !getOccurrenceCoverageKeys(occurrence, servicesByGroupId, undefined, timeZone)
        .every((key) => coveredOccurrenceKeys.has(key)),
    );
    if (!uncovered.length) {
      range = shiftRange("upcoming", range, 1);
      continue;
    }

    const serviceIds = getServiceIds(uncovered);
    const existingForm = coveringForms.find((form) =>
      form.startDate <= candidateRange.start && form.endDate >= candidateRange.end,
    );
    const label = monthLabel(range.start);
    if (existingForm) {
      return {
        kind: "update",
        formId: existingForm.formId,
        name: existingForm.name,
        startDate: range.start,
        endDate: range.end,
        serviceCount: serviceIds.length,
        occurrenceCount: uncovered.length,
        missingOccurrences: uncovered,
        draft: getDraftForForm(existingForm, uncovered, servicesById),
      };
    }

    const draft: TeamIntakeFormPayload = {
      name: `${label} Availability`,
      startDate: range.start,
      endDate: range.end,
      responseDeadline: range.end,
      availabilityServices: serviceIds.map((serviceId) => ({
        serviceId,
        name: servicesById.get(serviceId)?.name || serviceId,
      })),
        availabilityOccurrences: uncovered.map(({ occurrenceId, serviceId, name, startsAt, serviceDate }) => ({ occurrenceId, serviceId, name, startsAt, serviceDate })),
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
      kind: "create",
      name: draft.name,
      startDate: range.start,
      endDate: range.end,
      serviceCount: serviceIds.length,
      occurrenceCount: uncovered.length,
      missingOccurrences: uncovered,
      draft,
    };
  }
  return null;
};
