import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import {
  calendarDateInTimeZone,
  generateScheduleOccurrences,
} from "../../utils/teamScheduleOccurrences";

/**
 * Every occurrence of `serviceId` within [startDate, endDate] — generated
 * from the service's actual recurrence rule, never an arbitrary picked date.
 * Every service in the church is passed into `generateScheduleOccurrences`
 * (not just the selected one) so a combined/grouped service correctly merges
 * into its one shared occurrence identity instead of looking like it has none.
 */
export const getServiceOccurrencesInRange = ({
  services,
  serviceId,
  startDate,
  endDate,
  timeZone,
}: {
  services: TeamService[];
  serviceId: string;
  startDate: string;
  endDate: string;
  timeZone?: string;
}): TeamScheduleOccurrence[] => {
  if (!serviceId || !startDate || !endDate) return [];
  const all = generateScheduleOccurrences({
    services,
    serviceIds: services.map((service) => service.serviceId),
    startDate,
    endDate,
    timeZone,
  });
  return all.filter(
    (occurrence) =>
      occurrence.serviceId === serviceId ||
      occurrence.serviceIds?.includes(serviceId),
  );
};

/** The one_time case has exactly one possible occurrence — its own date — so
 * no range/list picker is needed; this resolves it directly. */
export const getOneTimeServiceOccurrence = (
  services: TeamService[],
  service: TeamService,
  timeZone?: string,
): TeamScheduleOccurrence | null => {
  const isoDate = service.overrideDateTimeISO || service.dateTimeISO;
  if (!isoDate) return null;
  const resolvedTimeZone =
    timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const date = calendarDateInTimeZone(new Date(isoDate), resolvedTimeZone);
  const [occurrence] = getServiceOccurrencesInRange({
    services,
    serviceId: service.serviceId,
    startDate: date,
    endDate: date,
    timeZone: resolvedTimeZone,
  });
  return occurrence || null;
};
