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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "long" });

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

  const coveredOccurrenceIds = new Set<string>();
  forms
    .filter((form) => form.active && !form.archivedAt)
    .forEach((form) => {
      getFormOccurrenceIds(form, services).forEach((id) => coveredOccurrenceIds.add(id));
    });

  // Look ahead only far enough to find the next useful month; no records are created.
  for (let offset = 0; offset < 12; offset += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const startDate = offset === 0 ? today : toPlainDate(month);
    const endDate = toPlainDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const occurrences = generateScheduleOccurrences({
      services: activeServices,
      serviceIds: activeServices.map(({ serviceId }) => serviceId),
      startDate,
      endDate,
    });
    const uncovered = occurrences.filter(({ occurrenceId }) => !coveredOccurrenceIds.has(occurrenceId));
    if (!uncovered.length) continue;

    const serviceIds = [...new Set(uncovered.flatMap((occurrence) => occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId]))];
    const template = safeTemplate(forms);
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
