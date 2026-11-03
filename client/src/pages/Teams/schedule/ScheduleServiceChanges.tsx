import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "../../../components/Button/Button";
import type { TeamPosition, TeamScheduleSummary, TeamService } from "../../../api/authTypes";
import { formatOccurrenceTiming, matchOccurrencesByIdentity, occurrenceScheduleDetailsMatch } from "@/utils/teamScheduleOccurrences";
import { resolveScheduleWorkspace, type ScheduleWorkspaceRow } from "./scheduleWorkspaceModel";

/** Compare the read model only. Resolution never copies or discards saved staffing. */
export default function ScheduleServiceChanges({
  churchId, teamId, range, timeZone, services, positions, schedules, onViewSaved, onManageSchedules,
}: {
  churchId: string;
  teamId: string;
  range: { start: string; end: string };
  timeZone: string;
  services: TeamService[];
  positions: TeamPosition[];
  schedules: TeamScheduleSummary[];
  onViewSaved: (scheduleId: string) => void;
  onManageSchedules: () => void;
}) {
  const { rows } = useMemo(() => resolveScheduleWorkspace({
    churchId, teamId, range, timeZone,
    // Shared serviceTimes records are scoped by the current church's RTDB path;
    // toTeamService intentionally does not add the churchId field.
    services: services.map((service) => ({ ...service, churchId })), positions, schedules,
  }), [churchId, teamId, range, timeZone, services, positions, schedules]);
  const savedRows = rows.filter((row) => row.owner);
  const changes = rows.filter((row) => !row.owner).map((proposed) => {
    const saved = savedRows.filter((row) => {
      const pair = matchOccurrencesByIdentity([row.occurrence], [proposed.occurrence], timeZone);
      return pair.matches.size > 0 || pair.ambiguousCurrentIds.size > 0;
    });
    const groupingChanged = saved.some((row) => row.identity && proposed.identity &&
      (row.identity.groupId !== proposed.identity.groupId ||
        row.identity.serviceIds.join("|") !== proposed.identity.serviceIds.join("|")) &&
      row.identity.serviceIds.some((id) => proposed.identity?.serviceIds.includes(id)));
    let reason = "Added service";
    if (proposed.status === "ambiguous") {
      reason = groupingChanged ? "Grouping changed" : "Identity needs review";
      if (new Set(saved.map((row) => row.owner?.scheduleId)).size > 1 && saved.every((row) =>
        matchOccurrencesByIdentity([row.occurrence], [proposed.occurrence], timeZone).matches.size > 0,
      )) reason = "Duplicate ownership";
    }
    return { proposed, saved, reason };
  });
  // Include unsafe legacy saved rows even when no current definition can identify them.
  savedRows.filter((row) => row.status === "ambiguous" &&
    !changes.some((change) => change.saved.includes(row)),
  ).forEach((row) => changes.push({ proposed: row, saved: [row], reason: "Identity needs review" }));
  savedRows.filter((row) => row.generatedOccurrence && !occurrenceScheduleDetailsMatch(
    [row.occurrence], [row.generatedOccurrence], timeZone,
  )).forEach((row) => changes.push({
    proposed: { ...row, occurrence: row.generatedOccurrence! }, saved: [row], reason: "Time changed",
  }));
  const describe = (row: ScheduleWorkspaceRow, showIdentity = false) => {
    const serviceIds = row.occurrence.serviceIds || [row.occurrence.serviceId];
    const names = serviceIds.map((id) => services.find((service) => service.serviceId === id)?.name || id).join(" + ");
    return `${row.occurrence.name} · ${formatOccurrenceTiming(row.occurrence, timeZone)} · ${names}${showIdentity ? ` · Service IDs: ${serviceIds.join(", ")}` : ""}`;
  };
  const affected = changes.filter((change) => change.reason !== "Added service");
  return (
    <div className="mt-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
      <p role="status">Saved assignments and equipment are preserved. Existing services remain visible while you review the changes.</p>
      <ul className="mt-2 list-disc pl-5">
        {affected.map((change, index) => (
          <li key={index}>{change.reason}: {change.saved.map((row) => row.occurrence.name).join(", ")} → {change.proposed.occurrence.name}</li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer font-medium">Compare service changes</summary>
        <section aria-label="Service changes" className="mt-3 space-y-3">
          {changes.map((change, index) => (
            <div key={index} className="border-t border-amber-700/50 pt-2">
              <p className="font-medium">{change.reason}</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div><p className="font-medium">Saved occurrence</p>
                  {change.saved.length ? change.saved.map((row) => <p key={`${row.owner?.scheduleId}:${row.occurrence.occurrenceId}`}>{describe(row, change.reason === "Identity needs review")} · {schedules.find((schedule) => schedule.scheduleId === row.owner?.scheduleId)?.name}</p>) : <p>No saved occurrence</p>}
                </div>
                <div><p className="font-medium">Current definition</p><p>{change.proposed.owner && !change.proposed.generatedOccurrence ? "No matching current definition" : describe(change.proposed, change.reason === "Identity needs review")}</p></div>
              </div>
            </div>
          ))}
          <p>For grouping or identity changes, check the affected services in Service setup. New services stay as previews until the definitions and ownership can be validated. No assignments or equipment are moved.</p>
          <div className="flex flex-wrap gap-2">
            <Link className="underline" to="/teams-and-services/service-setup">Open Service setup</Link>
            <Button variant="tertiary" onClick={onManageSchedules}>Manage saved schedules</Button>
            {[...new Set(affected.flatMap((change) => change.saved.flatMap((row) => row.owner ? [row.owner.scheduleId] : [])))].map((id) => (
              <Button key={id} variant="tertiary" onClick={() => onViewSaved(id)}>
                View saved version{affected.some((change) => change.reason === "Duplicate ownership") ? `: ${schedules.find((schedule) => schedule.scheduleId === id)?.name} (${id})` : ""}
              </Button>
            ))}
          </div>
        </section>
      </details>
    </div>
  );
}
