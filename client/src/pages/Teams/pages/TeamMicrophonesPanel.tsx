import { Link } from "react-router-dom";
import type { ServiceEquipment, ServicePlanMicrophone } from "../../../types/servicePlan";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";
import {
  getTeamEquipmentRows,
  teamEquipmentSlotKey,
  type TeamsAssignmentSummaryRow,
} from "./teamsAssignmentsSummary";
import type { TeamRecord } from "../../../api/authTypes";
import ScheduleEquipmentSelect from "../schedule/ScheduleEquipmentSelect";

type TeamEquipmentPanelProps = {
  /**
   * Scheduled rows for this service. The panel narrows them to teams that
   * support either microphone or IEM assignments.
   */
  rows: TeamsAssignmentSummaryRow[];
  microphones: ServicePlanMicrophone[];
  iems?: ServiceEquipment[];
  teams?: TeamRecord[];
  canEdit: boolean;
  /**
   * Whether this date's schedule cells are on the client. Schedules outside the
   * bootstrap's hydration window arrive without them, and the "assign people on
   * the schedule" guidance below would then be aimed at an operator who has
   * already done exactly that.
   */
  assignmentsStatus?: "ready" | "loading" | "unavailable";
  savingMicrophoneSlot?: string | null;
  /** Compatibility aliases for callers that still render the old mic panel. */
  savingSlot?: string | null;
  savingIemSlot?: string | null;
  onMicrophoneChange?: (
    row: TeamsAssignmentSummaryRow,
    microphoneIds: string[],
  ) => void;
  onIemChange?: (row: TeamsAssignmentSummaryRow, iemIds: string[]) => void;
  onChange?: (row: TeamsAssignmentSummaryRow, microphoneIds: string[]) => void;
};

type EquipmentTeamGroup = {
  key: string;
  teamName: string;
  rows: TeamsAssignmentSummaryRow[];
};

/** One block per team (per schedule), in the order the rows arrive. */
const groupRowsByTeam = (
  rows: TeamsAssignmentSummaryRow[],
): EquipmentTeamGroup[] => {
  const groups: EquipmentTeamGroup[] = [];
  const byKey = new Map<string, EquipmentTeamGroup>();
  for (const row of rows) {
    const key = `${row.teamId}::${row.scheduleId ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const group = { key, teamName: row.teamName, rows: [row] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
};

/**
 * Day-level equipment allocation for teams that opt in. It sits in its own
 * plan tab rather than inside the order of service: it answers who is expected
 * to hold each microphone for the whole service, before any item needs to
 * borrow one.
 */
const TeamEquipmentPanel = ({
  rows,
  microphones,
  iems = [],
  teams = [],
  canEdit,
  assignmentsStatus = "ready",
  savingMicrophoneSlot,
  savingSlot,
  savingIemSlot,
  onMicrophoneChange,
  onIemChange,
  onChange,
}: TeamEquipmentPanelProps) => {
  const microphoneChange = onMicrophoneChange || onChange || (() => undefined);
  const activeMicrophoneSavingSlot = savingMicrophoneSlot ?? savingSlot;
  const equipmentRows = teams.length
    ? getTeamEquipmentRows(rows, teams)
    : rows.filter((row) => Boolean(row.scheduleId));
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const hasMicrophoneTeams = teams.length === 0 || equipmentRows.some(
    (row) => teamById.get(row.teamId)?.usesMicrophoneAssignments,
  );
  const hasIemTeams = equipmentRows.some(
    (row) => teamById.get(row.teamId)?.usesIemAssignments,
  );
  const holdersByMicrophone = new Map<string, { slotKey: string; label: string }[]>();
  const holdersByIem = new Map<string, { slotKey: string; label: string }[]>();
  equipmentRows.forEach((row) => {
    const slotKey = teamEquipmentSlotKey(row);
    const label = row.memberName || row.slotLabel;
    const team = teamById.get(row.teamId);
    const usesMicrophones = team ? Boolean(team.usesMicrophoneAssignments) : true;
    const usesIems = team ? Boolean(team.usesIemAssignments) : false;
    if (usesMicrophones) {
      row.microphoneIds.forEach((microphoneId) => {
        const holders = holdersByMicrophone.get(microphoneId) || [];
        holders.push({ slotKey, label });
        holdersByMicrophone.set(microphoneId, holders);
      });
    }
    if (usesIems) {
      (row.iemIds || []).forEach((iemId) => {
        const holders = holdersByIem.get(iemId) || [];
        holders.push({ slotKey, label });
        holdersByIem.set(iemId, holders);
      });
    }
  });

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-gray-400">
        Equipment allocations for this service&apos;s scheduled roles. Sharing is
        allowed; warnings help the team spot conflicts early.
      </p>

      {hasMicrophoneTeams && microphones.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-700 bg-black/20 px-3 py-4 text-xs text-gray-400">
          No microphones in the church list yet.{" "}
          <Link
            to={TEAMS_SECTION_PATHS.microphones}
            className="cursor-pointer font-medium text-cyan-300 hover:text-cyan-200"
          >
            Open Microphones
          </Link>{" "}
          to add them, then allocate them here.
        </p>
      ) : null}

      {hasIemTeams && iems.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-700 bg-black/20 px-3 py-4 text-xs text-gray-400">
          No IEMs configured. Visit{" "}
          <Link
            to={TEAMS_SECTION_PATHS.microphones}
            className="cursor-pointer font-medium text-cyan-300 hover:text-cyan-200"
          >
            Equipment
          </Link>{" "}
          to add them, then allocate them here.
        </p>
      ) : null}

      {assignmentsStatus !== "ready" ? (
        <p
          className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-100"
          role="status"
        >
          {assignmentsStatus === "loading"
            ? "Loading this date's scheduled roles…"
            : "This date's scheduled roles haven't loaded, so some may be missing. Open the schedule to see them."}
        </p>
      ) : null}

      {equipmentRows.length === 0 && assignmentsStatus === "ready" ? (
        <p className="rounded-md border border-dashed border-gray-700 bg-black/20 px-3 py-4 text-xs text-gray-400">
          No scheduled roles for teams that use equipment yet. Assign people on
          the schedule, then allocate equipment here.
        </p>
      ) : null}

      {groupRowsByTeam(equipmentRows).map((group) => (
        <section key={group.key} className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-orange-300/90">
            {group.teamName}
          </h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
            {group.rows.map((row) => {
              const slotKey = teamEquipmentSlotKey(row);
              const team = teamById.get(row.teamId);
              // Rows are already eligible in normal callers. The fallback keeps
              // the compatibility panel useful in isolated tests/callers that
              // do not pass team metadata.
              const usesMicrophones = team ? Boolean(team.usesMicrophoneAssignments) : true;
              const usesIems = team ? Boolean(team.usesIemAssignments) : false;
              return (
                <li
                  key={slotKey}
                  className="rounded-md border border-gray-800 bg-gray-900/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    {row.memberProfileImageUrl ? (
                      <img
                        src={row.memberProfileImageUrl}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-full object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 max-w-[60%] flex-1 truncate text-xs font-medium text-gray-100">
                      {row.memberName || "Unassigned"}
                    </span>
                    <span className="min-w-0 shrink-0 truncate text-[11px] text-gray-400">
                      {row.slotLabel}
                    </span>
                  </div>
                  <ScheduleEquipmentSelect
                    microphoneIds={row.microphoneIds}
                    microphones={usesMicrophones ? microphones : []}
                    holdersByMicrophone={holdersByMicrophone}
                    slotKey={slotKey}
                    ariaLabel={`Microphone for ${row.memberName || "Unassigned"} (${row.slotLabel})`}
                    canEdit={canEdit}
                    saving={activeMicrophoneSavingSlot === slotKey}
                    onChange={(microphoneIds) => microphoneChange(row, microphoneIds)}
                    showMicrophones={usesMicrophones && microphones.length > 0}
                    iemIds={row.iemIds}
                    iems={usesIems ? iems : []}
                    iemHoldersByIem={holdersByIem}
                    savingIem={savingIemSlot === slotKey}
                    onIemChange={usesIems && iems.length > 0 ? (iemIds) => onIemChange?.(row, iemIds) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default TeamEquipmentPanel;
