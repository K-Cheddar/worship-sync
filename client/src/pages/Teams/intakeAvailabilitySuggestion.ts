import type {
  TeamIntakeForm,
  TeamPosition,
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
  TeamService,
} from "../../api/authTypes";
import type { TeamIntakeFormPayload } from "../../api/auth";
import { serverDate } from "../../utils/serverTime";
import { calendarDateInTimeZone, generateScheduleOccurrences, getOccurrenceDate } from "../../utils/teamScheduleOccurrences";
import { parsePlainDate } from "../../utils/plainDate";
import { ALL_INTAKE_FORM_FIELDS, resolveIntakeFormFields } from "./intakeFormFields";
import { getUpcomingServiceRange } from "./servicePeriodRange";
import { shiftRange } from "./rangeSelection";
import { buildTeamSchedulePeriod, findInitialTeamSchedulePeriod } from "./schedule/teamSchedulePeriod";

type SuggestedAvailabilityOccurrence = Pick<TeamScheduleOccurrence, "occurrenceId" | "serviceId" | "name" | "startsAt" | "serviceDate">;

type SuggestionBase = {
  name: string;
  startDate: string;
  endDate: string;
  serviceCount: number;
  occurrenceCount: number;
  teamIds: string[];
  missingOccurrences: TeamScheduleOccurrence[];
  draft: TeamIntakeFormPayload;
};

export type UpcomingAvailabilitySuggestion =
  | (SuggestionBase & { kind: "create" })
  | (SuggestionBase & { kind: "update"; formId: string })
  | (SuggestionBase & { kind: "review"; formId: string; reason: "closed" | "expired" });

const isOpen = (form: TeamIntakeForm, today: string) => {
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
  let serviceIds = occurrence.serviceIds?.length
    ? occurrence.serviceIds
    : groupedServiceIds || [occurrence.serviceId];
  if (allowedServiceIds?.size) serviceIds = serviceIds.filter((serviceId) => allowedServiceIds.has(serviceId));
  const date = getOccurrenceDate(occurrence, timeZone || "UTC");
  return [...new Set(serviceIds.length ? serviceIds : [occurrence.serviceId])]
    .map((serviceId) => `${serviceId}@${date}`);
};

const createGroupServiceIndex = (services: TeamService[]) => {
  const byGroupId = new Map<string, string[]>();
  services.forEach((service) => {
    if (!service.serviceGroupId) return;
    const ids = byGroupId.get(service.serviceGroupId) || [];
    ids.push(service.serviceId);
    byGroupId.set(service.serviceGroupId, ids);
  });
  return byGroupId;
};

const getServiceIds = (occurrences: TeamScheduleOccurrence[]) =>
  [...new Set(occurrences.flatMap((occurrence) =>
    occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId],
  ))];

const getDraftForForm = (
  form: TeamIntakeForm,
  missingOccurrences: TeamScheduleOccurrence[],
  servicesById: Map<string, TeamService>,
  purpose: "team_availability" | "general_intake" = "team_availability",
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
    availabilityServices.push({ serviceId, name: servicesById.get(serviceId)?.name || serviceId });
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
    enabledFields: purpose === "team_availability" ? ["availability"] : resolveIntakeFormFields(form),
    requireEmail: purpose === "team_availability" ? false : Boolean(form.requireEmail),
    welcomeMessage: form.welcomeMessage || "",
    positionsMessage: form.positionsMessage || "",
    availabilityMessage: form.availabilityMessage || "",
    notesMessage: form.notesMessage || "",
    purpose,
  };
};

const hasIssuedRequests = (form: TeamIntakeForm, issuedFormIds: Set<string>) =>
  issuedFormIds.has(form.formId) || Boolean(form.hasIssuedRecipientRequests || form.submissionCount);

/**
 * Suggestions are calculated independently for each team's required occurrences.
 * Teams share a form only when the exact missing service/date coverage is identical.
 */
export const getUpcomingAvailabilitySuggestions = ({
  services,
  forms,
  positions = [],
  schedules = [],
  teamIds,
  teamScheduleScope,
  issuedFormIds = [],
  now = serverDate(),
  timeZone,
}: {
  services: TeamService[];
  forms: TeamIntakeForm[];
  positions?: TeamPosition[];
  schedules?: Array<TeamSchedule | TeamScheduleSummary>;
  teamIds?: string[];
  teamScheduleScope?: boolean;
  issuedFormIds?: string[];
  now?: Date;
  timeZone?: string;
}): UpcomingAvailabilitySuggestion[] => {
  const today = calendarDateInTimeZone(now, timeZone || "UTC");
  const activeServices = services.filter((service) => !service.archivedAt);
  if (!activeServices.length) return [];
  const template = safeTemplate(forms);
  const teamScoped = teamScheduleScope ?? (teamIds !== undefined || template?.purpose === "team_availability");
  const scopedTeamIds = [...new Set(teamIds ?? template?.teamIds ?? [])].sort();
  if (teamScoped && !scopedTeamIds.length) return [];
  const groups = createGroupServiceIndex(activeServices);
  const servicesById = new Map(activeServices.map((service) => [service.serviceId, service]));
  const issuedIds = new Set(issuedFormIds);
  const allSuggestions: UpcomingAvailabilitySuggestion[] = [];

  if (!teamScoped) {
    // Preserve legacy general-intake suggestions for callers without a Team scope.
    const generalTeamScope = teamIds ?? template?.teamIds ?? [];
    const openForms = forms.filter((form) => {
      if (!isOpen(form, today) || !resolveIntakeFormFields(form).includes("availability")) return false;
      const existingScope = form.teamIds || [];
      return !generalTeamScope.length
        ? existingScope.length === 0
        : !existingScope.length || generalTeamScope.every((teamId) => existingScope.includes(teamId));
    });
    const covered = new Set<string>();
    openForms.forEach((form) => getFormOccurrences(form, activeServices, timeZone).forEach((occurrence) =>
        getOccurrenceCoverageKeys(occurrence, groups, new Set((form.availabilityServices || []).map(({ serviceId }) => serviceId)), timeZone)
          .forEach((key) => covered.add(key)),
      ));
    let range = getUpcomingServiceRange(activeServices, now, timeZone);
    for (let offset = 0; offset < 12; offset += 1) {
      const missing = generateScheduleOccurrences({ services: activeServices, serviceIds: activeServices.map(({ serviceId }) => serviceId),
        startDate: range.start, endDate: range.end, timeZone,
      }).filter((occurrence) => Date.parse(occurrence.startsAt) > now.getTime() &&
        !getOccurrenceCoverageKeys(occurrence, groups, undefined, timeZone).every((key) => covered.has(key)));
      if (!missing.length) {
        range = shiftRange("upcoming", range, 1);
        continue;
      }
      const serviceIds = getServiceIds(missing);
      const existing = openForms.find((form) => form.startDate <= range.start && form.endDate >= range.end);
      const purpose = (template?.purpose || "general_intake") as "team_availability" | "general_intake";
      const canUpdate = Boolean(existing && !hasIssuedRequests(existing, issuedIds));
      const draft = canUpdate && existing
        ? getDraftForForm(existing, missing, servicesById, purpose)
        : {
            name: `${monthLabel(range.start)} Availability`, startDate: range.start, endDate: range.end, responseDeadline: range.end,
            availabilityServices: serviceIds.map((serviceId) => ({ serviceId, name: servicesById.get(serviceId)?.name || serviceId })),
            availabilityOccurrences: missing.map(({ occurrenceId, serviceId, name, startsAt, serviceDate }) => ({ occurrenceId, serviceId, name, startsAt, serviceDate })),
            teamIds: [...generalTeamScope], purpose, active: true,
            enabledFields: template ? resolveIntakeFormFields(template) : [...ALL_INTAKE_FORM_FIELDS],
            requireEmail: Boolean(template?.requireEmail), welcomeMessage: template?.welcomeMessage || "",
            positionsMessage: template?.positionsMessage || "", availabilityMessage: template?.availabilityMessage || "", notesMessage: template?.notesMessage || "",
          } satisfies TeamIntakeFormPayload;
      if (canUpdate && existing) {
        allSuggestions.push({ kind: "update", formId: existing.formId, name: existing.name, startDate: range.start, endDate: range.end,
          serviceCount: serviceIds.length, occurrenceCount: missing.length, teamIds: [...generalTeamScope], missingOccurrences: missing, draft });
      } else {
        allSuggestions.push({ kind: "create", name: draft.name, startDate: range.start, endDate: range.end,
          serviceCount: serviceIds.length, occurrenceCount: missing.length, teamIds: [...generalTeamScope], missingOccurrences: missing, draft });
      }
      break;
    }
    return allSuggestions;
  }

  type TeamCoverage = { teamId: string; range: { start: string; end: string }; missing: TeamScheduleOccurrence[]; review: Array<{ form: TeamIntakeForm; reason: "closed" | "expired" }> };
  const teamCoverage: TeamCoverage[] = [];
  for (const teamId of scopedTeamIds) {
    const initial = findInitialTeamSchedulePeriod({ services: activeServices, positions, teamId, schedules, now, timeZone });
    if (!initial.nextOccurrence) continue;
    let range = { start: initial.start, end: initial.end };
    const teamForms = forms.filter((form) =>
      !form.archivedAt && resolveIntakeFormFields(form).includes("availability") &&
      (!(form.teamIds || []).length || (form.teamIds || []).includes(teamId)),
    );
    const openCoverage = new Set<string>();
    const closedCoverage = new Map<string, { form: TeamIntakeForm; reason: "closed" | "expired" }>();
    teamForms.forEach((form) => {
      const isFormOpen = isOpen(form, today);
      const reason = form.active ? "expired" : "closed";
      const allowed = new Set((form.availabilityServices || []).map(({ serviceId }) => serviceId));
      getFormOccurrences(form, activeServices, timeZone).forEach((occurrence) =>
        getOccurrenceCoverageKeys(occurrence, groups, allowed, timeZone).forEach((key) => {
          if (isFormOpen) openCoverage.add(key);
          else if (!closedCoverage.has(key)) closedCoverage.set(key, { form, reason });
        }),
      );
    });
    for (let offset = 0; offset < 12; offset += 1) {
      const candidates = buildTeamSchedulePeriod({ services: activeServices, positions, teamId, schedules, startDate: range.start, endDate: range.end, timeZone }).occurrences
        .filter((occurrence) => Date.parse(occurrence.startsAt) > now.getTime());
      const missing = candidates.flatMap((occurrence) => {
        const uncoveredServiceIds = getOccurrenceCoverageKeys(occurrence, groups, undefined, timeZone)
          .filter((key) => !openCoverage.has(key) && !closedCoverage.has(key))
          .map((key) => key.slice(0, key.lastIndexOf("@")));
        return uncoveredServiceIds.length ? [{ ...occurrence, serviceIds: [...new Set(uncoveredServiceIds)] }] : [];
      });
      const reviewForms = new Map<string, { form: TeamIntakeForm; reason: "closed" | "expired" }>();
      candidates.forEach((occurrence) => getOccurrenceCoverageKeys(occurrence, groups, undefined, timeZone).forEach((key) => {
        const closed = closedCoverage.get(key);
        if (closed && !openCoverage.has(key)) reviewForms.set(closed.form.formId, closed);
      }));
      if (missing.length || reviewForms.size) {
        teamCoverage.push({ teamId, range, missing, review: [...reviewForms.values()] });
        break;
      }
      range = shiftRange("upcoming", range, 1);
    }
  }

  const byMissingSet = new Map<string, TeamCoverage[]>();
  const reviewOnly: TeamCoverage[] = [];
  teamCoverage.forEach((coverage) => {
    if (coverage.review.length) reviewOnly.push({ ...coverage, missing: [] });
    if (!coverage.missing.length) return;
    const signature = `${coverage.range.start}:${coverage.range.end}:${coverage.missing.flatMap((occurrence) =>
      getOccurrenceCoverageKeys(occurrence, groups, undefined, timeZone),
    ).sort().join("|")}`;
    const rows = byMissingSet.get(signature) || [];
    rows.push(coverage);
    byMissingSet.set(signature, rows);
  });

  byMissingSet.forEach((rows) => {
    const targetTeamIds = rows.map(({ teamId }) => teamId).sort();
    const missing = rows[0].missing;
    const range = rows[0].range;
    const serviceIds = getServiceIds(missing);
    const matchingForm = forms.find((form) =>
      !form.archivedAt && isOpen(form, today) && resolveIntakeFormFields(form).includes("availability") &&
      form.purpose === "team_availability" &&
      JSON.stringify([...(form.teamIds || [])].sort()) === JSON.stringify(targetTeamIds) &&
      form.startDate <= range.start && form.endDate >= range.end && !hasIssuedRequests(form, issuedIds),
    );
    if (matchingForm) {
      allSuggestions.push({ kind: "update", formId: matchingForm.formId, name: matchingForm.name, startDate: range.start,
        endDate: range.end, serviceCount: serviceIds.length, occurrenceCount: missing.length, teamIds: targetTeamIds,
        missingOccurrences: missing, draft: getDraftForForm(matchingForm, missing, servicesById) });
    } else {
      const draft: TeamIntakeFormPayload = {
        name: `${monthLabel(range.start)} Availability`, startDate: range.start, endDate: range.end, responseDeadline: range.end,
        availabilityServices: serviceIds.map((serviceId) => ({ serviceId, name: servicesById.get(serviceId)?.name || serviceId })),
        availabilityOccurrences: missing.map(({ occurrenceId, serviceId, name, startsAt, serviceDate }) => ({ occurrenceId, serviceId, name, startsAt, serviceDate })),
        teamIds: targetTeamIds, purpose: "team_availability", active: true, enabledFields: ["availability"], requireEmail: false,
        welcomeMessage: "", positionsMessage: "", availabilityMessage: "", notesMessage: "",
      };
      allSuggestions.push({ kind: "create", name: draft.name, startDate: range.start, endDate: range.end,
        serviceCount: serviceIds.length, occurrenceCount: missing.length, teamIds: targetTeamIds,
        missingOccurrences: missing, draft });
    }
  });

  reviewOnly.forEach(({ teamId, range, review }) => review.forEach(({ form, reason }) => {
    allSuggestions.push({ kind: "review", formId: form.formId, reason, name: form.name, startDate: range.start,
      endDate: range.end, serviceCount: 0, occurrenceCount: 0, teamIds: [teamId], missingOccurrences: [],
      draft: {
        name: form.name, startDate: form.startDate, endDate: form.endDate, responseDeadline: form.responseDeadline || form.endDate,
        availabilityServices: form.availabilityServices || [], availabilityOccurrences: form.availabilityOccurrences || [],
        teamIds: form.teamIds || [], active: form.active, enabledFields: resolveIntakeFormFields(form), requireEmail: Boolean(form.requireEmail),
        welcomeMessage: form.welcomeMessage || "", positionsMessage: form.positionsMessage || "", availabilityMessage: form.availabilityMessage || "",
        notesMessage: form.notesMessage || "", purpose: "team_availability",
      },
    });
  }));
  return allSuggestions.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.teamIds.join().localeCompare(right.teamIds.join()));
};

/** Backward-compatible single suggestion accessor for focused callers and tests. */
export const getUpcomingAvailabilitySuggestion = (args: Parameters<typeof getUpcomingAvailabilitySuggestions>[0]) =>
  getUpcomingAvailabilitySuggestions(args)[0] || null;
