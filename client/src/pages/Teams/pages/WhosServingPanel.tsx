import { ChevronRight, Pencil, Users } from "lucide-react";
import Button from "../../../components/Button/Button";
import Icon from "../../../components/Icon/Icon";
import { ServicePlanMicrophoneChip } from "../../../components/ServicePlanMicrophoneChip";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import ScheduleFillBadge from "../schedule/ScheduleFillBadge";
import {
  summarizeNeededPositions,
  type TeamsAssignmentSummaryRow,
  type TeamsAssignmentSummaryTeamGroup,
} from "./teamsAssignmentsSummary";

export type WhosServingPanelProps = {
  assignmentTeams: TeamsAssignmentSummaryTeamGroup[];
  onOpenSchedule: (args: {
    scheduleId: string;
    slot?: { occurrenceId: string; columnKey: string };
  }) => void;
  /**
   * Church microphone catalog, so a row can name the microphones the schedule
   * allocated to it. Allocation itself happens in the plan's Microphones tab.
   */
  microphones?: ServicePlanMicrophone[];
  /**
   * Whether this date's assignments are actually on the client. Schedules
   * outside the bootstrap's hydration window arrive without their cells, and a
   * roster built from what's left is indistinguishable from nobody being
   * scheduled — so anything other than "ready" is said out loud.
   */
  assignmentsStatus?: "ready" | "loading" | "unavailable";
  /** When false, skip the panel title (e.g. a Sheet/tab already provides one). */
  showHeading?: boolean;
};

/**
 * The microphones this slot holds, skipping ids the catalog no longer has.
 * Both lists are short (a slot holds one or two, a church lists a handful), so
 * this stays a plain lookup rather than an indexed map.
 */
const rowMicrophones = (
  row: TeamsAssignmentSummaryRow,
  microphones: ServicePlanMicrophone[],
): ServicePlanMicrophone[] =>
  row.microphoneIds
    .map((microphoneId) =>
      microphones.find((microphone) => microphone.id === microphoneId))
    .filter((microphone): microphone is ServicePlanMicrophone =>
      Boolean(microphone));

/**
 * Read-only roster summary for the selected plan date: which team, which
 * position, who is on it, and what they are holding. Edit opens that team's
 * schedule; unfilled counts deep-link into the first open slot.
 */
const WhosServingPanel = ({
  assignmentTeams,
  onOpenSchedule,
  microphones = [],
  assignmentsStatus = "ready",
  showHeading = true,
}: WhosServingPanelProps) => (
  <>
    {showHeading ? (
      <div className="flex items-center gap-2">
        <Icon svg={Users} size="sm" className="text-orange-300" />
        <h3 className="text-sm font-semibold">Who&apos;s serving</h3>
      </div>
    ) : null}
    {assignmentsStatus === "ready" ? null : (
      <p
        className="rounded-md bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-100"
        role="status"
      >
        {assignmentsStatus === "loading"
          ? "Loading who's serving on this date…"
          : "Who's serving on this date hasn't loaded, so names may be missing. Open the schedule to see it."}
      </p>
    )}
    {assignmentTeams.length === 0 ? (
      <p className="text-xs text-gray-400">
        No positions required for this service yet. Add them in Service
        settings.
      </p>
    ) : (
      <div className="space-y-3">
        {assignmentTeams.map((team) => {
          const scheduleId = team.scheduleId;
          const teamHeader = (
            <>
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-[11px] font-semibold uppercase tracking-wide text-orange-300/90">
                  {team.teamName}
                </h4>
                {/* Only set when this team has more than one schedule
                    over this date — otherwise the heading repeats with
                    different numbers and reads like a bug. */}
                {team.scheduleName ? (
                  <p className="truncate text-[11px] font-normal normal-case text-gray-500">
                    {team.scheduleName}
                  </p>
                ) : null}
              </div>
              <ScheduleFillBadge
                filled={team.filled.length}
                required={team.filled.length + team.unfilled.length}
              />
            </>
          );
          // No schedule covers this date for this team, so there is no
          // grid to open — list what the service needs instead.
          if (!scheduleId) {
            return (
              <section
                key={`${team.teamId}-unscheduled`}
                className="space-y-1.5"
              >
                <div className="flex w-full items-center justify-between gap-2 px-1.5 py-1">
                  {teamHeader}
                </div>
                <ul className="space-y-1.5">
                  {summarizeNeededPositions(team.unfilled).map((need) => (
                    <li
                      key={need.positionId}
                      className="flex items-center justify-between gap-2 px-1.5 text-xs"
                    >
                      <span className="truncate text-gray-400">
                        {need.positionName}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-500">
                        &times;{need.count}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="px-1.5 text-[11px] text-gray-500">
                  Not scheduled yet
                </p>
              </section>
            );
          }
          return (
            <section
              key={`${team.teamId}-${scheduleId}`}
              className="space-y-1.5"
            >
              <div className="flex w-full items-center justify-between gap-2 px-1.5 py-1">
                {teamHeader}
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Pencil}
                  iconSize="sm"
                  padding="px-2 py-1"
                  className="shrink-0 text-xs"
                  aria-label={`Edit ${team.teamName} schedule`}
                  onClick={() => onOpenSchedule({ scheduleId })}
                >
                  Edit
                </Button>
              </div>
              <ul className="space-y-1.5">
                {team.filled.map((row) => {
                  const heldMicrophones = rowMicrophones(row, microphones);
                  return (
                    <li
                      key={`${scheduleId}-${row.columnKey}`}
                      className="flex w-full items-center gap-2 px-1.5 py-1"
                    >
                      {/* Position + mic share the left; name stays opposite.
                          One row when it fits; truncate instead of stacking. */}
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="min-w-0 truncate text-xs text-gray-400">
                          {row.slotLabel}
                        </span>
                        {heldMicrophones.length ? (
                          <span className="flex shrink-0 items-center gap-1">
                            {heldMicrophones.map((microphone) => (
                              <ServicePlanMicrophoneChip
                                key={microphone.id}
                                microphone={microphone}
                              />
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="max-w-[45%] shrink-0 truncate text-xs font-medium text-gray-100">
                        {row.memberName}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {team.unfilled.length > 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-start gap-1 rounded-md px-1.5 py-1 text-left text-xs font-medium text-amber-300 transition-colors hover:bg-gray-800/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/70"
                  onClick={() =>
                    onOpenSchedule({
                      scheduleId,
                      slot: {
                        occurrenceId: team.unfilled[0].occurrenceId,
                        columnKey: team.unfilled[0].columnKey,
                      },
                    })
                  }
                  aria-label={`Fill ${team.unfilled.length} open ${team.unfilled.length === 1 ? "position" : "positions"} for ${team.teamName}`}
                >
                  {team.unfilled.length} unfilled
                  <Icon svg={ChevronRight} size="xs" />
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    )}
  </>
);

export default WhosServingPanel;
