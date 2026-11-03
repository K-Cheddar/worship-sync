import { useMemo } from "react";
import { X } from "lucide-react";
import type { TeamScheduleOccurrence } from "../../../api/authTypes";
import Button from "../../../components/Button/Button";
import { formatOccurrenceTiming } from "@/utils/teamScheduleOccurrences";

type AddedServiceSummary = {
  key: string;
  name: string;
  occurrenceCount: number;
  firstOccurrence: TeamScheduleOccurrence;
};

export const summarizeAddedServiceOccurrences = (
  addedOccurrences: TeamScheduleOccurrence[],
): AddedServiceSummary[] => {
  const grouped = new Map<string, AddedServiceSummary>();
  addedOccurrences.forEach((occurrence) => {
    const serviceIds = [...new Set(occurrence.serviceIds?.length
      ? occurrence.serviceIds
      : [occurrence.serviceId])].sort();
    const key = JSON.stringify([occurrence.groupId || "", serviceIds]);
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
    } else {
      grouped.set(key, {
        key,
        name: occurrence.name || serviceIds.join(" + "),
        occurrenceCount: 1,
        firstOccurrence: occurrence,
      });
    }
  });
  return [...grouped.values()].sort((left, right) =>
    left.firstOccurrence.startsAt.localeCompare(right.firstOccurrence.startsAt) ||
    left.name.localeCompare(right.name),
  );
};

export const scheduleServiceAdditionDismissalKey = ({
  churchId,
  teamId,
  scheduleId,
  occurrenceIds,
}: {
  churchId: string;
  teamId: string;
  scheduleId: string;
  occurrenceIds: string[];
}) => `worshipsync:schedule-addition-dismissed:${encodeURIComponent(JSON.stringify([
  churchId,
  teamId,
  scheduleId,
  [...new Set(occurrenceIds)].sort(),
]))}`;

const ScheduleServiceAdditionNotice = ({
  addedOccurrences,
  periodName,
  timeZone,
  onDismiss,
}: {
  addedOccurrences: TeamScheduleOccurrence[];
  periodName: string;
  timeZone: string;
  onDismiss: () => void;
}) => {
  const services = useMemo(() => summarizeAddedServiceOccurrences(addedOccurrences), [addedOccurrences]);
  if (!services.length) return null;

  const visibleServices = services.slice(0, 3);
  const hiddenServiceCount = services.length - visibleServices.length;
  const heading = services.length === 1 ? "New service added" : `${services.length} new services added`;

  return (
    <div role="status" aria-label="New service addition" className="mt-3 flex items-start gap-3 rounded border border-emerald-700 bg-emerald-950/30 p-3 text-sm text-emerald-100">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{heading}</p>
        <ul className="mt-1 space-y-1">
          {visibleServices.map((service) => (
            <li key={service.key}>
              {service.name} — {service.occurrenceCount > 1
                ? `${service.occurrenceCount} occurrences, first ${formatOccurrenceTiming(service.firstOccurrence, timeZone)}`
                : formatOccurrenceTiming(service.firstOccurrence, timeZone)}
            </li>
          ))}
        </ul>
        {hiddenServiceCount > 0 ? (
          <p className="mt-1">And {hiddenServiceCount} more service{hiddenServiceCount === 1 ? "" : "s"} added.</p>
        ) : null}
        <p className="mt-1">Added to your {periodName} schedule.</p>
      </div>
      <Button
        type="button"
        variant="tertiary"
        svg={X}
        iconSize="sm"
        aria-label="Dismiss service addition notice"
        onClick={onDismiss}
      />
    </div>
  );
};

export default ScheduleServiceAdditionNotice;
