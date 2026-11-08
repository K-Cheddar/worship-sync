import type { TeamScheduleOccurrence } from "../../../api/authTypes";
import { formatOccurrenceTiming } from "@/utils/teamScheduleOccurrences";
import type { ScheduleSendScope } from "./scheduleWorkspaceModel";

const ScheduleSendScopeNotice = ({
  scope,
  timeZone,
}: {
  scope: ScheduleSendScope;
  timeZone: string;
}) => {
  const entries = [
    ...scope.servicePreviews.map((occurrence) => ({ kind: "New service", occurrence })),
    ...scope.conflictPreviews.map((occurrence) => ({ kind: "Needs review", occurrence })),
  ].sort((left, right) => left.occurrence.startsAt.localeCompare(right.occurrence.startsAt));
  if (!entries.length) return null;

  const visibleEntries = entries.slice(0, 3);
  const additionalEntries = entries.slice(3);
  const countLabel = `${entries.length} current service preview${entries.length === 1 ? "" : "s"}`;
  const renderEntry = ({ kind, occurrence }: { kind: string; occurrence: TeamScheduleOccurrence }) => (
    <li key={`${kind}:${occurrence.occurrenceId}`}>
      {kind}: {occurrence.name} · {formatOccurrenceTiming(occurrence, timeZone)}
    </li>
  );

  return (
    <div role="status" aria-label="Schedule message scope" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
      <p>Only assignments saved in this schedule are included. {countLabel} will be left out.</p>
      <p className="mt-1">Sending won’t reconcile services, create assignments, or resolve conflicts.</p>
      {scope.conflictPreviews.length ? (
        <p className="mt-1">Saved assignments remain eligible to send.</p>
      ) : null}
      <ul aria-label="Service dates not included" className="mt-2 list-disc space-y-1 pl-5">
        {visibleEntries.map(renderEntry)}
      </ul>
      {additionalEntries.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Show {additionalEntries.length} more service dates</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {additionalEntries.map(renderEntry)}
          </ul>
        </details>
      ) : null}
    </div>
  );
};

export default ScheduleSendScopeNotice;
